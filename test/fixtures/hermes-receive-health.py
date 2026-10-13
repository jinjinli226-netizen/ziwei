"""Installed adapters; Slack SDK absent: native lifecycle + controlled SDK boundary.
No production credentials or remote connections. Local sockets are allowed only.
"""
import asyncio
import contextlib
import importlib.util
import inspect
import io
import ipaddress
import json
import os
from pathlib import Path
import socket
import tempfile
import time
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('health_bridge', ROOT / 'src/hermes-native-bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
_connect = socket.socket.connect
def local_only(self, address):
    if isinstance(address, tuple) and not ipaddress.ip_address(address[0]).is_loopback:
        raise RuntimeError('external network forbidden')
    return _connect(self, address)
socket.socket.connect = local_only

async def observe(adapter, name='slack'):
    result = bridge.adapter_health(adapter, name)
    return await result if inspect.isawaitable(result) else result

class ReceiveHealth(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='e02-receive-health-')
        self.addCleanup(self.temp.cleanup)
        env = patch.dict(os.environ, {'HERMES_HOME': self.temp.name})
        env.start(); self.addCleanup(env.stop)
        from hermes_state_registry import close_all_under
        self.addCleanup(close_all_under, self.temp.name)

    def adapter(self, name, class_name):
        import importlib
        from gateway.config import PlatformConfig
        return getattr(importlib.import_module('plugins.platforms.' + name + '.adapter'), class_name)(PlatformConfig.from_dict({'enabled': True}))

    def track_task(self, task=None):
        task = task or asyncio.create_task(asyncio.Event().wait())
        async def cleanup():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self.addAsyncCleanup(cleanup)
        return task

    async def slack(self):
        from plugins.platforms.slack.adapter import SlackAdapter
        from gateway.config import PlatformConfig
        adapter = SlackAdapter(PlatformConfig.from_dict({'enabled': True}))
        adapter._running = True
        adapter._app = object(); adapter._app_token = 'fixture-only'
        adapter._socket_handler_started_monotonic = time.monotonic()
        async def connected(): return True
        async def close(): pass
        adapter._handler = NS(client=NS(is_connected=connected, ping_interval=10, last_ping_pong_time=time.time()), close_async=close)
        adapter._socket_mode_task = asyncio.create_task(asyncio.Event().wait())
        adapter._handler.client.message_receiver = asyncio.create_task(asyncio.Event().wait())
        adapter._handler.client.message_processor = asyncio.create_task(asyncio.Event().wait())
        tasks = [adapter._socket_mode_task, adapter._handler.client.message_receiver, adapter._handler.client.message_processor]
        async def cleanup():
            for task in tasks: task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        self.addAsyncCleanup(cleanup)
        self.addAsyncCleanup(adapter.disconnect)
        return adapter

    async def test_missing_listener_and_exact_native_restart_failure(self):
        adapter = await self.slack()
        def fail_start(): raise RuntimeError('isolated restart rejected')
        with patch.object(adapter, '_start_socket_mode_handler', fail_start):
            await adapter._restart_socket_mode('isolated test')
        self.assertTrue(adapter.is_connected, 'reproduce native stale running flag')
        self.assertIsNone(adapter._handler)
        self.assertEqual((await observe(adapter))[0], 'retrying')

    async def test_listener_transport_stale_and_unknown_are_not_connected(self):
        adapter = await self.slack()
        client = adapter._handler.client
        self.assertEqual(await observe(adapter), ('connected', None))
        for value, expected in [(False, 'retrying'), (None, 'unconfirmed')]:
            with self.subTest(value=value):
                client.is_connected = value
                self.assertEqual((await observe(adapter))[0], expected)
        client.is_connected = True; client.last_ping_pong_time = time.time() - 1000
        self.assertEqual((await observe(adapter))[0], 'retrying')
        client.last_ping_pong_time = time.time()
        adapter._socket_mode_task.cancel()
        await asyncio.gather(adapter._socket_mode_task, return_exceptions=True)
        self.assertEqual((await observe(adapter))[0], 'retrying')

    async def test_reconnect_lock_closes_admission_even_with_old_open_socket(self):
        adapter = await self.slack()
        async with adapter._socket_reconnect_lock:
            self.assertEqual((await observe(adapter))[0], 'retrying')
        self.assertEqual(await observe(adapter), ('connected', None))

    async def test_native_restart_recovers_only_after_new_receiver_is_ready(self):
        adapter = await self.slack()
        old_handler = adapter._handler
        def start():
            async def close(): pass
            adapter._handler = NS(client=NS(is_connected=False, ping_interval=10, last_ping_pong_time=time.time(),
                message_receiver=self.track_task(), message_processor=self.track_task()), close_async=close)
            adapter._socket_mode_task = self.track_task()
        with patch.object(adapter, '_start_socket_mode_handler', start):
            await adapter._restart_socket_mode('isolated recovery')
        self.assertIsNot(adapter._handler, old_handler)
        self.assertEqual((await observe(adapter))[0], 'retrying')
        adapter._handler.client.is_connected = True
        self.assertEqual(await observe(adapter), ('connected', None))

    async def test_sdk_receiver_task_ended_or_unobservable(self):
        adapter = await self.slack()
        adapter._handler.client.message_receiver.cancel()
        await asyncio.gather(adapter._handler.client.message_receiver, return_exceptions=True)
        self.assertEqual((await observe(adapter))[0], 'retrying')
        adapter._handler.client.message_receiver = None
        self.assertEqual((await observe(adapter))[0], 'unconfirmed')

    async def test_async_probe_cannot_accept_replaced_handler(self):
        adapter = await self.slack()
        async def replaced():
            adapter._handler = None
            return True
        adapter._handler.client.is_connected = replaced
        self.assertNotEqual((await observe(adapter))[0], 'connected')

    async def test_fatal_during_async_probe_wins_and_hides_raw_message(self):
        adapter = await self.slack()
        async def fatal():
            adapter._set_fatal_error('slack_auth_error', 'private fixture detail', retryable=False)
            return True
        adapter._handler.client.is_connected = fatal
        self.assertEqual(await observe(adapter), ('failed', 'slack_auth_error'))

    async def test_probe_exception_or_timeout_is_unconfirmed(self):
        adapter = await self.slack()
        async def broken(): raise RuntimeError('private fixture detail')
        adapter._handler.client.is_connected = broken
        self.assertEqual((await observe(adapter))[0], 'unconfirmed')
        async def stalled(): await asyncio.Event().wait()
        adapter._handler.client.is_connected = stalled
        self.assertEqual((await asyncio.wait_for(observe(adapter), 2))[0], 'unconfirmed')

    async def test_actual_loopback_socket_and_native_disconnect(self):
        from aiohttp import web, ClientSession
        async def receive(request):
            ws = web.WebSocketResponse(); await ws.prepare(request)
            async for _ in ws: pass
            return ws
        app = web.Application(); app.router.add_get('/', receive)
        runner = web.AppRunner(app); await runner.setup()
        site = web.TCPSite(runner, '127.0.0.1', 0); await site.start()
        self.addAsyncCleanup(runner.cleanup)
        async with ClientSession() as session:
            async with session.ws_connect('http://127.0.0.1:' + str(site._server.sockets[0].getsockname()[1])) as ws:
                adapter = await self.slack()
                async def connected(): return not ws.closed
                adapter._handler.client.is_connected = connected
                self.assertEqual(await observe(adapter), ('connected', None))
                await ws.close()
                self.assertEqual((await observe(adapter))[0], 'retrying')
                await adapter.disconnect()
                self.assertEqual((await observe(adapter))[0], 'disconnected')

    async def test_other_platforms_do_not_inherit_running_as_receive_proof(self):
        for name, class_name in [('telegram','TelegramAdapter'),('discord','DiscordAdapter'),('feishu','FeishuAdapter'),('dingtalk','DingTalkAdapter')]:
            with self.subTest(platform=name):
                adapter = self.adapter(name, class_name)
                adapter._running = True
                self.assertNotEqual((await observe(adapter, name))[0], 'connected')
        fake = NS(has_fatal_error=False, is_connected=True, send_path_degraded=False)
        self.assertEqual((await observe(fake, 'future_plugin'))[0], 'unconfirmed')

    async def test_telegram_native_polling_generation_requires_progress_and_recovers(self):
        adapter = self.adapter('telegram', 'TelegramAdapter')
        adapter._running = True
        adapter._app = NS(updater=NS(running=True))
        generation, _ = adapter._begin_polling_generation()
        self.assertEqual((await observe(adapter, 'telegram'))[0], 'retrying')
        self.assertTrue(adapter._record_polling_progress(generation))
        self.assertEqual(await observe(adapter, 'telegram'), ('connected', None))
        adapter._fence_polling()
        self.assertFalse(adapter._record_polling_progress(generation))
        self.assertEqual((await observe(adapter, 'telegram'))[0], 'retrying')
        generation, _ = adapter._begin_polling_generation()
        self.assertTrue(adapter._record_polling_progress(generation))
        self.assertEqual(await observe(adapter, 'telegram'), ('connected', None))
        adapter._app.updater.running = False
        self.assertEqual((await observe(adapter, 'telegram'))[0], 'retrying')
        adapter._webhook_mode = True
        self.assertEqual((await observe(adapter, 'telegram'))[0], 'unconfirmed')

    async def test_discord_native_probe_requires_live_receiver_and_fresh_ack(self):
        adapter = self.adapter('discord', 'DiscordAdapter')
        adapter._running = True
        adapter._bot_task = self.track_task()
        adapter._client = NS(is_ready=lambda:True, is_closed=lambda:False, latency=.01,
            ws=NS(open=True, _keep_alive=NS(_last_ack=time.perf_counter())))
        self.assertEqual(await observe(adapter, 'discord'), ('connected', None))
        adapter._client.ws._keep_alive._last_ack -= 1000
        self.assertEqual((await observe(adapter, 'discord'))[0], 'retrying')
        adapter._client.ws._keep_alive._last_ack = time.perf_counter()
        self.assertEqual(await observe(adapter, 'discord'), ('connected', None))
        adapter._bot_task.cancel()
        await asyncio.gather(adapter._bot_task, return_exceptions=True)
        self.assertEqual((await observe(adapter, 'discord'))[0], 'retrying')

    async def test_feishu_actual_sdk_connection_reports_local_socket_close(self):
        import websockets
        from lark_oapi.ws.client import Client, _ws_connect_kwargs
        adapter = self.adapter('feishu', 'FeishuAdapter')
        adapter._running = True
        adapter._ws_client = Client('fixture', 'fixture')
        self.track_task(adapter._ws_client._cache._cron)
        adapter._ws_future = self.track_task()
        adapter._ws_thread_loop = asyncio.get_running_loop()
        async def receive(ws): await ws.wait_closed()
        async with websockets.serve(receive, '127.0.0.1', 0) as server:
            async with websockets.connect('ws://127.0.0.1:' + str(server.sockets[0].getsockname()[1]), **_ws_connect_kwargs()) as ws:
                adapter._ws_client._conn = ws
                self.assertEqual(await observe(adapter, 'feishu'), ('connected', None))
                await ws.close()
                self.assertEqual((await observe(adapter, 'feishu'))[0], 'retrying')
        adapter._ws_client._conn = None

    async def test_feishu_webhook_requires_actual_serving_listener(self):
        from aiohttp import web
        adapter = self.adapter('feishu', 'FeishuAdapter')
        adapter._running = True; adapter._connection_mode = 'webhook'
        runner = adapter._webhook_runner = web.AppRunner(web.Application())
        await runner.setup()
        self.addAsyncCleanup(runner.cleanup)
        site = web.TCPSite(runner, '127.0.0.1', 0); await site.start()
        self.assertEqual(await observe(adapter, 'feishu'), ('connected', None))
        await site.stop()
        self.assertEqual((await observe(adapter, 'feishu'))[0], 'failed')

    async def test_dingtalk_receiving_socket_recovers_but_unknown_api_stays_unconfirmed(self):
        adapter = self.adapter('dingtalk', 'DingTalkAdapter')
        adapter._running = True; adapter._stream_task = self.track_task()
        adapter._stream_client = NS(websocket=NS(open=True))
        self.assertEqual(await observe(adapter, 'dingtalk'), ('connected', None))
        adapter._stream_client.websocket.open = False
        self.assertEqual((await observe(adapter, 'dingtalk'))[0], 'retrying')
        adapter._stream_client.websocket = NS(state=NS(name='OPEN'))
        self.assertEqual(await observe(adapter, 'dingtalk'), ('connected', None))
        adapter._stream_client.websocket = NS()
        self.assertEqual((await observe(adapter, 'dingtalk'))[0], 'unconfirmed')


class WorkerAdmission(unittest.TestCase):
    def test_slack_missing_receiver_does_not_emit_inbound_or_send(self):
        with tempfile.TemporaryDirectory(prefix='e02-slack-worker-') as home, patch.dict(os.environ, {'HERMES_HOME': home}):
            from plugins.platforms.slack.adapter import SlackAdapter
            from gateway.config import PlatformConfig
            from gateway.platform_registry import platform_registry
            from hermes_state_registry import close_all_under
            adapter = SlackAdapter(PlatformConfig.from_dict({'enabled': True}))
            sends = []
            async def connect():
                adapter._running = True
                event = NS(source=NS(user_id='fixture', chat_id='chat'), message_id='original', text='fixture')
                asyncio.create_task(adapter._message_handler(event))
                return True
            async def send(*args, **kwargs): sends.append(args); return NS(success=True, message_id='unexpected')
            adapter.connect = connect; adapter.send = send
            class Commands:
                def __iter__(self):
                    time.sleep(.15)
                    yield json.dumps({'operation':'send','commandId':'late','chatId':'chat','content':'fixture'})+'\n'
                    time.sleep(.2)
                    yield json.dumps({'operation':'disconnect'})+'\n'
            output = io.StringIO()
            context = {'employeeId':'employee_slack','name':'Fixture','workspace':'isolated','revision':1,'controlEpoch':1,'config':{'gateway':{'platforms':{'slack':{'enabled':True,'allowedUsers':['fixture']}}}}}
            try:
                with patch('hermes_cli.plugins.discover_plugins',lambda:None), patch.object(platform_registry,'is_registered',return_value=True), patch.object(platform_registry,'create_adapter',return_value=adapter), patch('sys.stdin',Commands()), contextlib.redirect_stdout(output):
                    bridge.run_gateway_worker({'actionId':'isolated','input':{'platform':'slack','durationSeconds':1}},context)
                events = [json.loads(line.split(':',1)[1]) for line in output.getvalue().splitlines() if line.startswith('ZIWEI_GATEWAY_EVENT:')]
                self.assertEqual(sends,[])
                self.assertFalse(any(event['event'] in {'connected','inbound'} for event in events))
                state=json.loads((Path(home)/'ziwei-gateway-state/slack.json').read_text())
                self.assertEqual(state['code'],'GATEWAY_LISTENER_UNAVAILABLE')
            finally: close_all_under(home)

if __name__ == '__main__': unittest.main(verbosity=2)
