"""Isolated regression: real installed Room policy and Mattermost lifecycle, no account/network."""
import asyncio
import contextlib
import importlib.util
import io
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ziwei_followup_bridge', ROOT / 'src/hermes-native-bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class NativeFollowup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ziwei-native-followup-')
        self.addCleanup(self.temp.cleanup)
        self.environment = patch.dict(os.environ, {'HERMES_HOME': self.temp.name})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        from hermes_state_registry import close_all_under
        self.addCleanup(close_all_under, self.temp.name)
        self.context = {'employeeId': 'employee_native_source', 'name': 'Source', 'workspace': 'isolated', 'revision': 1, 'controlEpoch': 1, 'config': {}}

    def group(self, text):
        return bridge.collaboration('message', {'targets': [{'id': 'employee_native_peer', 'name': 'Peer'}], 'mode': 'group', 'groupId': 'group_exact_source', 'content': text}, self.context, 'exact-source')

    def test_exact_source_is_a_native_plan_target(self):
        result = self.group('@employee_native_source Please answer.')
        self.assertEqual(result['plan']['payload']['target_member_id'], self.context['employeeId'])
        self.assertEqual(len(result['room']['members']), 2)

    def test_unknown_and_source_prefix_mentions_are_rejected(self):
        for mention in ['employee_unknown', 'employee_native_source.fake', 'employee_native_peer:other', 'all']:
            with self.subTest(mention=mention), self.assertRaisesRegex(bridge.NativeOperationError, 'GROUP_MENTION_NOT_AUTHORIZED'):
                self.group('@' + mention + ' answer')

    def worker(self, mode):
        from plugins.platforms.mattermost.adapter import MattermostAdapter
        from gateway.config import PlatformConfig
        from gateway.platform_registry import platform_registry
        import aiohttp
        adapter = MattermostAdapter(PlatformConfig.from_dict({'enabled': True, 'token': 'isolated-only', 'extra': {'url': 'http://127.0.0.1:1'}}))
        async def identity(path): return None if mode == 'credentials' else {'id': 'fixture', 'username': 'fixture'}
        adapter._api_get = identity
        async def close_socket(): pass
        async def listener():
            adapter._ws = SimpleNamespace(closed=False, close=close_socket)
            await asyncio.sleep(.12)
            if mode == 'fatal': raise aiohttp.WSServerHandshakeError(None, (), status=401, message='isolated authentication rejection')
            if mode == 'disconnected':
                adapter._mark_disconnected()
                adapter._closing = True
                return
            if mode == 'recovery':
                adapter._ws.closed = True
                await asyncio.sleep(.38)
                adapter._ws.closed = False
            await asyncio.sleep(60)
        adapter._ws_connect_and_listen = listener
        if mode == 'listener':
            async def ended_listener():
                adapter._ws = SimpleNamespace(closed=False, close=close_socket)
                await asyncio.sleep(.12)
            adapter._ws_loop = ended_listener
        sends = []
        async def send(*args, **kwargs):
            sends.append(args)
            if mode == 'uncertain': raise asyncio.TimeoutError()
            return SimpleNamespace(success=True, message_id='should-not-send')
        adapter.send = send
        adapter._wire_plugin_handlers = lambda _: None
        class Commands:
            def __iter__(self):
                time.sleep(.3)
                if mode == 'uncertain':
                    for index in range(2):
                        yield json.dumps({'operation': 'send', 'commandId': 'send-' + str(index), 'messageId': 'original', 'chatId': 'chat', 'content': 'reply'}) + '\n'
                        time.sleep(.1)
                    yield json.dumps({'operation': 'disconnect'}) + '\n'
                    return
                yield json.dumps({'operation': 'send', 'commandId': 'late-send', 'chatId': 'chat', 'content': 'late'}) + '\n'
                if mode == 'recovery':
                    time.sleep(.5)
                    yield json.dumps({'operation': 'disconnect'}) + '\n'
                    return
                time.sleep(7)
        if mode == 'recovery':
            from hermes_state_registry import acquire
            db = acquire(Path(self.temp.name) / 'state.db')
            for status in ['pending', 'accepted', 'delivery_started', 'delivered', 'delivery_failed']:
                db.set_meta('ziwei.gateway.inbound:' + status, json.dumps({'platform': 'mattermost', 'sourceActionId': 'owned-connection', 'state': status, 'revision': 1, 'controlEpoch': 1, 'messageId': status, 'chatId': 'chat', 'content': 'fixture'}))
        if mode == 'uncertain':
            from hermes_state_registry import acquire
            db = acquire(Path(self.temp.name) / 'state.db')
            key = 'ziwei.gateway.inbound:' + hashlib.sha256(json.dumps(['mattermost', 'chat', 'original']).encode()).hexdigest()
            db.set_meta(key, json.dumps({'platform': 'mattermost', 'sourceActionId': 'owned-connection', 'state': 'pending', 'revision': 1, 'controlEpoch': 1, 'messageId': 'original', 'chatId': 'chat', 'content': 'fixture'}))
        self.context['config'] = {'gateway': {'platforms': {'mattermost': {'enabled': True, 'allowedUsers': ['fixture']}}}}
        output = io.StringIO()
        with patch('hermes_cli.plugins.discover_plugins', lambda: None), patch.object(platform_registry, 'is_registered', return_value=True), patch.object(platform_registry, 'create_adapter', return_value=adapter), patch('sys.stdin', Commands()), contextlib.redirect_stdout(output):
            bridge.run_gateway_worker({'actionId': 'owned-connection', 'input': {'platform': 'mattermost', 'durationSeconds': 6}}, self.context)
        events = [json.loads(line.split(':', 1)[1]) for line in output.getvalue().splitlines() if line.startswith('ZIWEI_GATEWAY_EVENT:')]
        state = json.loads((Path(self.temp.name) / 'ziwei-gateway-state/mattermost.json').read_text())
        return state, events, sends

    def test_native_mattermost_ws_auth_fatal_is_not_connected(self):
        state, events, sends = self.worker('fatal')
        self.assertEqual(state['status'], 'failed')
        self.assertEqual(state['code'], 'mattermost_auth_error')
        self.assertTrue(any(event.get('status') == 'failed' for event in events))
        self.assertEqual(sends, [])
        self.assertFalse(any(event.get('event') == 'heartbeat' and event.get('status') == 'connected' for event in events))

    def test_ended_native_listener_is_not_connected(self):
        state, events, sends = self.worker('listener')
        self.assertEqual(state['status'], 'failed')
        self.assertEqual(state['code'], 'GATEWAY_LISTENER_ENDED')
        self.assertEqual(sends, [])

    def test_native_disconnect_stops_new_sends(self):
        state, events, sends = self.worker('disconnected')
        self.assertEqual(state['status'], 'disconnected')
        self.assertEqual(sends, [])

    def test_native_credential_rejection_preserves_failed_state(self):
        state, events, sends = self.worker('credentials')
        self.assertEqual(state['status'], 'failed')
        self.assertFalse(any(event['event'] == 'connected' for event in events))
        self.assertEqual(sends, [])

    def test_recovery_republishes_only_unattempted_original_deliveries(self):
        state, events, sends = self.worker('recovery')
        inbound = [event['messageId'] for event in events if event['event'] == 'inbound']
        self.assertEqual(sorted(inbound), ['accepted', 'accepted', 'pending', 'pending'])
        self.assertTrue(any(event.get('status') == 'retrying' for event in events))
        self.assertEqual(sends, [])

    def test_unknown_send_is_not_replayed(self):
        state, events, sends = self.worker('uncertain')
        results = [event for event in events if event['event'] == 'command_result']
        self.assertEqual(len(sends), 1)
        self.assertEqual([event['code'] for event in results], ['EXECUTION_UNCERTAIN', 'EXECUTION_UNCERTAIN'])
        self.assertTrue(results[1]['duplicate'])

    def test_real_webhook_listener_must_still_be_serving(self):
        from gateway.platforms.webhook import WebhookAdapter
        from gateway.config import PlatformConfig
        async def check():
            adapter = WebhookAdapter(PlatformConfig.from_dict({'enabled': True, 'extra': {'host': '127.0.0.1', 'port': 0}}))
            adapter._wire_plugin_handlers = lambda _: None
            try:
                self.assertTrue(await adapter.connect())
                self.assertEqual(await bridge.adapter_health(adapter, 'webhook'), ('connected', None))
                for site in list(adapter._runner.sites): await site.stop()
                self.assertEqual(await bridge.adapter_health(adapter, 'webhook'), ('failed', 'GATEWAY_LISTENER_ENDED'))
            finally:
                await adapter.disconnect()
        asyncio.run(check())


if __name__ == '__main__':
    unittest.main(verbosity=2)
