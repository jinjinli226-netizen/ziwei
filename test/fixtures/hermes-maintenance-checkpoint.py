"""No model/network: the real bridge against SQLite and concurrent tool batches."""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).resolve().parents[2] / 'src/hermes-maintenance-checkpoint.py'
spec = importlib.util.spec_from_file_location('checkpoint', SOURCE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class Checkpoints(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ziwei-checkpoint-')
        self.root = Path(self.temp.name).resolve()
        self.home, self.cwd, self.control = (self.root / name for name in ('home', 'work', 'control'))
        for path in (self.home, self.cwd, self.control, self.root / 'hermes_cli'):
            path.mkdir()
        (self.root / 'hermes_cli/main.py').write_text('# --resume --no-restore-cwd\n')
        self.previous_cwd, self.previous_home = Path.cwd(), os.environ.get('HERMES_HOME')
        os.chdir(self.cwd)
        os.environ['HERMES_HOME'] = str(self.home)
        self.settings = {'schemaVersion': 1, 'actionId': 'action_test', 'executionBinding': 'a' * 64, 'nonce': 'b' * 64, 'profile': 'test-profile', 'home': str(self.home), 'cwd': str(self.cwd), 'directory': str(self.control), 'resume': None}
        self.file = self.control / 'settings.json'
        self.file.write_text(json.dumps(self.settings))
        with sqlite3.connect(self.home / 'state.db') as db:
            db.execute('CREATE TABLE messages(id INTEGER,session_id TEXT,role TEXT,content TEXT,tool_calls TEXT,tool_call_id TEXT,PRIMARY KEY(session_id,id))')
        self.effects = []
        self.registry = SimpleNamespace(has_any_active=lambda: False)
        owner = self
        class Agent:
            def __init__(self, sid='session-initial', parallel=False):
                self.session_id, self.interrupted, self.parallel = sid, False, parallel
                self._session_messages = [{'role': 'user', 'content': 'original authorized goal'}]
                self._active_children = []
                self._incremental_persistence_failed = False
                self.before_tool = lambda name: None
                self.after_tools = lambda: None
            def _flush_messages_to_session_db(self, messages):
                with sqlite3.connect(owner.home / 'state.db') as db:
                    for i, msg in enumerate(messages):
                        db.execute('INSERT OR REPLACE INTO messages VALUES(?,?,?,?,?,?)', (i + 1, self.session_id, msg['role'], msg.get('content'), json.dumps(msg['tool_calls']) if msg.get('tool_calls') else None, msg.get('tool_call_id')))
                return True
            def _persist_session(self, messages, history=None):
                return self._flush_messages_to_session_db(messages)
            def interrupt(self, *, tool_reason=None):
                self.interrupted = True
                owner.effects.append('interrupt')
            def _execute_tool_calls(self, assistant_message, messages, task_id):
                def perform(call):
                    self.before_tool(call.id)
                    owner.effects.append(call.id)
                    return {'role': 'tool', 'tool_call_id': call.id, 'content': 'external receipt ' + call.id}
                if self.parallel:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                        rows = list(pool.map(perform, assistant_message.tool_calls))
                else:
                    rows = [perform(call) for call in assistant_message.tool_calls]
                messages.extend(rows)
                self._flush_messages_to_session_db(messages)
                self.after_tools()
            def run_conversation(self, user_message='continue remaining work'):
                self.last_prompt = user_message
                for count in range(2):
                    calls = [SimpleNamespace(id='tool-' + str(count) + '-' + str(i), function=SimpleNamespace(name='terminal')) for i in range(2 if self.parallel else 1)]
                    self._session_messages.append({'role': 'assistant', 'tool_calls': [{'id': x.id, 'function': {'name': x.function.name}} for x in calls]})
                    self._flush_messages_to_session_db(self._session_messages)
                    self._execute_tool_calls(SimpleNamespace(tool_calls=calls), self._session_messages, 'task')
                    if self.interrupted:
                        break
                self._persist_session(self._session_messages)
                return {'failed': False, 'interrupted': self.interrupted}
        self.Agent = Agent
    def tearDown(self):
        os.chdir(self.previous_cwd)
        if self.previous_home is None:
            os.environ.pop('HERMES_HOME', None)
        else:
            os.environ['HERMES_HOME'] = self.previous_home
        self.temp.cleanup()
    def request(self):
        (self.control / 'request.json').write_text(json.dumps({'schemaVersion': 1, 'nonce': self.settings['nonce'], 'id': 'client-update-test', 'targetBuild': 'c' * 64}))
    def install(self):
        return bridge.install(str(self.file), str(self.root), self.Agent, self.registry)
    def receipt(self):
        return json.loads((self.control / 'checkpoint.json').read_text())['receipt']
    def test_completed_tool_receipt_is_durable_and_not_replayed(self):
        finish = self.install()
        agent = self.Agent()
        agent.after_tools = self.request
        agent.run_conversation()
        self.assertEqual(self.effects, ['tool-0-0', 'interrupt'])
        self.assertFalse((self.control / 'checkpoint.json').exists())
        finish()
        receipt = self.receipt()
        self.assertEqual(receipt['pendingTools'], 0)
        self.assertEqual(receipt['messageCount'], 3)
        self.assertEqual(receipt['checkpointDigest'], bridge.session_snapshot(self.home, agent.session_id)['checkpointDigest'])
        self.assertNotIn('original authorized goal', (self.control / 'checkpoint.json').read_text())
    def test_request_before_batch_records_truthful_not_dispatched_results(self):
        finish = self.install()
        self.request()
        agent = self.Agent()
        agent.run_conversation()
        finish()
        self.assertEqual(self.effects, ['interrupt'])
        self.assertEqual(self.receipt()['pendingTools'], 0)
        self.assertIn('not dispatched', agent._session_messages[-1]['content'])
    def test_parallel_batch_waits_for_every_tool_before_interrupt(self):
        finish = self.install()
        agent = self.Agent(parallel=True)
        slow_started, release = threading.Event(), threading.Event()
        def before(name):
            if name.endswith('-1'):
                slow_started.set()
                release.wait(5)
            else:
                slow_started.wait(5)
                self.request()
        agent.before_tool = before
        failure = []
        def run():
            try:
                agent.run_conversation()
            except Exception as e:
                failure.append(e)
        thread = threading.Thread(target=run)
        thread.start()
        self.assertTrue(slow_started.wait(5))
        self.assertFalse(agent.interrupted)
        self.assertFalse((self.control / 'checkpoint.json').exists())
        release.set()
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(failure, [])
        finish()
        self.assertEqual(set(self.effects[:-1]), {'tool-0-0', 'tool-0-1'})
        self.assertEqual(self.effects[-1], 'interrupt')
        self.assertEqual(self.receipt()['pendingTools'], 0)
    def test_final_receipt_uses_current_compressed_child_session(self):
        finish = self.install()
        agent = self.Agent()
        def after():
            agent.session_id = 'compressed-child-session'
            self.request()
        agent.after_tools = after
        agent.run_conversation()
        finish()
        self.assertEqual(self.receipt()['sessionId'], 'compressed-child-session')
    def test_failed_flush_never_creates_a_resumable_receipt(self):
        finish = self.install()
        agent = self.Agent()
        agent.after_tools = lambda: (self.request(), setattr(agent, '_incremental_persistence_failed', True))
        agent.run_conversation()
        finish()
        self.assertNotIn('interrupt', self.effects)
        self.assertFalse(json.loads((self.control / 'ready.json').read_text())['supported'])
        self.assertFalse((self.control / 'checkpoint.json').exists())
    def test_background_child_defers_pause_until_a_later_completed_batch(self):
        finish = self.install()
        agent = self.Agent()
        child = object()
        agent._active_children = [child]
        self.request()
        def after():
            if self.effects == ['tool-0-0']:
                self.assertFalse(agent.interrupted)
                self.assertFalse((self.control / 'checkpoint.json').exists())
                agent._active_children.clear()
        agent.after_tools = after
        agent.run_conversation()
        finish()
        self.assertEqual(self.effects, ['tool-0-0', 'interrupt'])
        self.assertEqual(self.receipt()['pendingTools'], 0)
    def test_running_background_children_are_never_signalled_or_claimed_paused(self):
        finish = self.install()
        agent = self.Agent()
        agent._active_children = [object()]
        self.request()
        agent.run_conversation()
        finish()
        self.assertEqual(self.effects, ['tool-0-0', 'tool-1-0'])
        self.assertFalse(agent.interrupted)
        self.assertFalse((self.control / 'checkpoint.json').exists())
    def test_changed_native_schema_declines_maintenance_without_interrupting_work(self):
        finish = self.install()
        agent = self.Agent()
        def after():
            self.request()
            with sqlite3.connect(self.home / 'state.db') as db:
                db.execute('ALTER TABLE messages RENAME COLUMN tool_call_id TO changed_tool_id')
            agent.after_tools = lambda: None
        agent.after_tools = after
        agent.run_conversation()
        finish()
        self.assertEqual(self.effects, ['tool-0-0', 'tool-1-0'])
        self.assertFalse(agent.interrupted)
        self.assertFalse(json.loads((self.control / 'ready.json').read_text())['supported'])
        self.assertFalse((self.control / 'checkpoint.json').exists())
    def test_async_native_abi_is_not_wrapped_as_synchronous_pause(self):
        async def asynchronous_tools(agent, assistant_message, messages, task_id):
            return None
        self.Agent._execute_tool_calls = asynchronous_tools
        finish = self.install()
        self.assertIs(self.Agent._execute_tool_calls, asynchronous_tools)
        self.assertFalse(json.loads((self.control / 'ready.json').read_text())['supported'])
        finish()
    def test_auxiliary_agents_cannot_claim_the_root_owner_checkpoint(self):
        finish = self.install()
        self.request()
        for attr, value in (('_persist_disabled', True), ('_delegate_depth', 1), ('side_agent', True), ('_parent_session_id', 'parent-aux')):
            auxiliary = self.Agent('aux-' + attr.strip('_'))
            setattr(auxiliary, attr, value)
            auxiliary.run_conversation()
            self.assertFalse(auxiliary.interrupted)
            self.assertFalse((self.control / 'checkpoint.json').exists())
        root = self.Agent('actual-root')
        root._parent_session_id = 'prior-compression-parent'
        root.platform = 'cli'
        root.run_conversation()
        finish()
        self.assertTrue(root.interrupted)
        self.assertEqual(self.receipt()['sessionId'], 'actual-root')
        self.assertEqual(self.effects.count('interrupt'), 1)
    def test_native_background_registry_must_confirm_idle_before_interrupt(self):
        running = {'active': False}
        self.registry.has_any_active = lambda: running['active']
        finish = self.install()
        agent = self.Agent()
        def after():
            if self.effects == ['tool-0-0']:
                running['active'] = True
                self.request()
            else:
                self.assertFalse(agent.interrupted)
                self.assertEqual(json.loads((self.control / 'ready.json').read_text())['phase'], 'defer_until_background_exit')
                running['active'] = False
        agent.after_tools = after
        agent.run_conversation()
        finish()
        self.assertEqual(self.effects, ['tool-0-0', 'tool-1-0', 'interrupt'])
        self.assertEqual(self.receipt()['pendingTools'], 0)
    def test_unknown_background_registry_cannot_authorize_maintenance_pause(self):
        self.registry = SimpleNamespace()
        finish = self.install()
        self.request()
        agent = self.Agent()
        agent.run_conversation()
        finish()
        self.assertFalse(agent.interrupted)
        self.assertFalse(json.loads((self.control / 'ready.json').read_text())['supported'])
        self.assertFalse((self.control / 'checkpoint.json').exists())
    def test_unsupported_native_continues_normally_without_advertising_pause(self):
        self.Agent.interrupt = None
        finish = self.install()
        self.request()
        self.Agent().run_conversation()
        finish()
        self.assertFalse(json.loads((self.control / 'ready.json').read_text())['supported'])
        self.assertEqual(self.effects, ['tool-0-0', 'tool-1-0'])
    def test_changed_session_or_scope_rejects_resume_before_a_tool_runs(self):
        finish = self.install()
        agent = self.Agent()
        agent.after_tools = self.request
        agent.run_conversation()
        finish()
        self.settings['resume'] = self.receipt()
        self.file.write_text(json.dumps(self.settings))
        with sqlite3.connect(self.home / 'state.db') as db:
            db.execute("UPDATE messages SET content='changed' WHERE role='tool'")
        self.effects.clear()
        with self.assertRaises(bridge.CheckpointError):
            self.install()
        self.assertEqual(self.effects, [])
    def test_phone_command_must_reach_its_original_terminal_receipt_before_pause(self):
        audit = self.control / 'phone.jsonl'
        handshake = {'method': 'initialize', 'ok': True}
        started = {'method': 'tools/call', 'toolName': 'ziwei_phone_action', 'ok': True, 'commandId': 'device-command-one', 'commandStatus': 'executing', 'commandExecutionState': 'pending'}
        observed = {'method': 'tools/call', 'toolName': 'ziwei_phone_receipt', 'ok': True, 'commandId': 'device-command-one', 'commandStatus': 'succeeded', 'commandExecutionState': 'succeeded'}
        audit.write_text(json.dumps(handshake) + '\n')
        self.settings['audits'] = {'phone': str(audit)}
        self.file.write_text(json.dumps(self.settings))
        finish = self.install()
        agent = self.Agent()
        def after():
            if self.effects == ['tool-0-0']:
                with audit.open('a') as stream:
                    stream.write(json.dumps(started) + '\n')
                self.request()
            else:
                self.assertFalse(agent.interrupted)
                self.assertEqual(json.loads((self.control / 'ready.json').read_text())['phase'], 'defer_until_receipt')
                with audit.open('a') as stream:
                    stream.write(json.dumps(observed) + '\n')
        agent.after_tools = after
        agent.run_conversation()
        finish()
        self.assertEqual(self.effects, ['tool-0-0', 'tool-1-0', 'interrupt'])
        self.assertEqual(self.receipt()['pendingTools'], 0)
        self.assertEqual(audit.read_text(), ''.join(json.dumps(row) + '\n' for row in (handshake, started, observed)))
    def test_uncertain_or_unmapped_phone_receipts_and_unknown_management_writes_defer(self):
        audit = self.control / 'audit.jsonl'
        handshake = {'method': 'initialize', 'ok': True}
        submit = {'method': 'tools/call', 'toolName': 'ziwei_phone_action', 'ok': True, 'commandId': 'command-one', 'commandStatus': 'succeeded', 'commandExecutionState': 'uncertain'}
        audit.write_text(''.join(json.dumps(row) + '\n' for row in (handshake, submit)))
        original = audit.read_bytes()
        self.assertFalse(bridge.external_receipts_ready({'phone': str(audit)}))
        self.assertEqual(audit.read_bytes(), original)
        for row in (
            {'method': 'tools/call', 'toolName': 'ziwei_phone_action', 'ok': False},
            {'method': 'tools/call', 'toolName': 'ziwei_phone_upgrade', 'ok': True, 'updateId': 'update-one', 'updateStatus': 'staged'},
        ):
            audit.write_text(''.join(json.dumps(item) + '\n' for item in (handshake, row)))
            self.assertFalse(bridge.external_receipts_ready({'phone': str(audit)}))
        for row in (
            {'method': 'tools/call', 'toolName': 'ziwei_write_document', 'ok': False},
            {'method': 'tools/call', 'toolName': 'ziwei_bot', 'ok': True, 'actionId': 'action-child'},
            {'method': 'tools/call', 'toolName': 'ziwei_bot', 'ok': True, 'resourceId': 'action-child'},
            {'method': 'tools/call', 'toolName': 'ziwei_write_document', 'ok': True, 'resourceId': 'doc-child'},
        ):
            audit.write_text(''.join(json.dumps(item) + '\n' for item in (handshake, row)))
            self.assertFalse(bridge.external_receipts_ready({'management': str(audit)}))
        audit.write_text(''.join(json.dumps(item) + '\n' for item in (handshake, {'method': 'tools/call', 'toolName': 'ziwei_get_action', 'ok': False})))
        self.assertTrue(bridge.external_receipts_ready({'management': str(audit)}))
    def test_known_failed_phone_receipt_is_not_pending_or_reported_as_success(self):
        audit = self.control / 'phone.jsonl'
        rows = [{'method': 'initialize', 'ok': True}, {'method': 'tools/call', 'toolName': 'ziwei_phone_action', 'ok': True, 'commandId': 'command-one', 'commandStatus': 'executing'}, {'method': 'tools/call', 'toolName': 'ziwei_phone_status', 'ok': True, 'receipts': [{'commandId': 'command-one', 'status': 'failed', 'executionState': 'not_started'}]}]
        audit.write_text(''.join(json.dumps(row) + '\n' for row in rows))
        before = audit.read_bytes()
        self.assertTrue(bridge.external_receipts_ready({'phone': str(audit)}))
        self.assertEqual(audit.read_bytes(), before)
    def test_phone_control_enrollment_and_unknown_tools_cannot_claim_completed_work(self):
        audit = self.control / 'phone.jsonl'
        handshake = {'method': 'initialize', 'ok': True}
        for name in ('ziwei_phone_control', 'ziwei_enrollment_approve', 'unknown_tool', None):
            for ok in (False, True):
                with self.subTest(tool=name, ok=ok):
                    row = {'method': 'tools/call', 'toolName': name, 'ok': ok,
                           'commandStatus': 'succeeded', 'commandExecutionState': 'not_started'}
                    audit.write_text(''.join(json.dumps(item) + '\n' for item in (handshake, row)))
                    before = audit.read_bytes()
                    self.assertFalse(bridge.external_receipts_ready({'phone': str(audit)}))
                    self.assertEqual(audit.read_bytes(), before)
        for name in ('ziwei_phone_list', 'ziwei_phone_status', 'ziwei_phone_receipt',
                     'ziwei_phone_wait', 'ziwei_enrollment_pending'):
            audit.write_text(''.join(json.dumps(item) + '\n' for item in
                                    (handshake, {'method': 'tools/call', 'toolName': name, 'ok': False})))
            self.assertTrue(bridge.external_receipts_ready({'phone': str(audit)}))
    def test_missing_session_and_pending_tool_result_are_not_checkpoints(self):
        with self.assertRaises(bridge.CheckpointError):
            bridge.session_snapshot(self.home, 'missing-session')
        with sqlite3.connect(self.home / 'state.db') as db:
            db.execute('INSERT INTO messages VALUES(1,?,\'assistant\',NULL,?,NULL)', ('pending-session', json.dumps([{'id': 'pending-tool'}])))
        self.assertEqual(bridge.session_snapshot(self.home, 'pending-session')['pendingTools'], 1)


if __name__ == '__main__':
    unittest.main()
