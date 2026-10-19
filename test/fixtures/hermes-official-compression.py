"""Official-ABI adaptation regression; isolated modules, no listeners/network/models."""
import contextlib
from dataclasses import dataclass
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ziwei_official_compression_test', ROOT / 'src/hermes-official-compression.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class OfficialCompression(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='ziwei-official-compression-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        (self.root / 'agent').mkdir()
        (self.root / 'hermes_cli').mkdir()
        self.calls, self.flushes, self.notifications = [], [], []
        self.mode = 'success'
        self.after = [{'role': 'user', 'content': 'official compacted task and completed result'}]
        test = self

        @dataclass
        class CompressRequest:
            preview: bool = False
            aggressive: bool = False
            partial: bool = False
            keep_last: int = 2
            focus_topic: str = None

        # The signature intentionally matches actual Li Hermes 0.21.3:
        # no snapshot_is_current or verbatim_tail keyword is fabricated.
        def compress_now(agent, history, request, *, system_message=None, task_id='default', skip_without_window=False):
            test.calls.append({'agent': agent, 'history': list(history), 'request': request, 'task_id': task_id})
            if test.mode == 'exception':
                raise RuntimeError('SECRET_PROVIDER_BODY')
            if test.mode == 'cancel_during':
                agent._interrupt_requested = True
            if test.mode == 'rotate':
                agent.session_id = 'official-successor-session'
            summary = {'noop': test.mode == 'noop', 'aborted': test.mode == 'aborted',
                       'refused_would_grow': test.mode == 'refused', 'fallback_used': test.mode == 'fallback'}
            status = 'preview' if request.preview else 'lock_skipped' if test.mode == 'lock' else 'compressed'
            after = [{'role': 'assistant', 'tool_calls': [{'id': 'unanswered'}]}] if test.mode == 'invalid' else test.after
            return types.SimpleNamespace(status=status, before_messages=list(history), before_tokens=120000, after_tokens=120000 if test.mode == 'no_shrink' else 24000,
                                         after_messages=after, summary=summary)

        def finalize_context_engine_compression_notification(agent, committed):
            test.notifications.append(committed)

        manual = types.ModuleType('agent.conversation_compression_manual')
        lifecycle = types.ModuleType('agent.conversation_compression')
        manual.__file__ = str(self.root / 'agent/conversation_compression_manual.py')
        lifecycle.__file__ = str(self.root / 'agent/conversation_compression.py')
        manual.CompressRequest, manual.compress_now = CompressRequest, compress_now
        lifecycle.finalize_context_engine_compression_notification = finalize_context_engine_compression_notification
        self.manual = manual
        self.modules = patch.dict(sys.modules, {'agent.conversation_compression_manual': manual, 'agent.conversation_compression': lifecycle})
        self.modules.start()
        self.addCleanup(self.modules.stop)

        class Agent:
            def __init__(self):
                self.session_id = 'original-native-session'
                self._interrupt_requested = False
                self._session_messages = []
                self.platform = 'cli'
                self.seen = []

            def _flush_messages_to_session_db(self, messages, conversation_history=None):
                test.flushes.append((list(messages), conversation_history))

            def run_conversation(self, user_message, system_message=None, conversation_history=None, task_id=None, **kwargs):
                self.seen.append({'prompt': user_message, 'history': conversation_history, 'task_id': task_id})
                if len(self.seen) == 1 or test.mode == 'twice':
                    return {'completed': False, 'failed': True, 'compression_exhausted': True,
                            'failure_reason': 'context_overflow', 'messages': test.history, 'error': 'native context failure'}
                if test.mode == 'continuation_exception':
                    raise RuntimeError('native follow-up failed after tools')
                return {'completed': True, 'final_response': 'remaining work completed', 'messages': conversation_history}

        self.Agent = Agent
        self.history = [{'role': 'user', 'content': 'ORIGINAL_TASK_DO_NOT_REPLAY'},
                        {'role': 'assistant', 'tool_calls': [{'id': 'completed-phone-call'}]},
                        {'role': 'tool', 'tool_call_id': 'completed-phone-call', 'content': 'succeeded, command-1'},
                        {'role': 'assistant', 'content': 'preserved completed work'}]

    def compress(self, **kwargs):
        agent = self.Agent()
        receipt, after = bridge.compress_agent(agent, self.history, native_root=self.root, **kwargs)
        return agent, receipt, after

    def install(self, **kwargs):
        bridge.install(self.root, agent_class=self.Agent, external_ready=lambda: True, background_idle=lambda: True, **kwargs)

    def test_0213_abi_uses_official_core_and_inplace_commit(self):
        before = json.dumps(self.history)
        agent, receipt, after = self.compress(keep_last=2, focus_topic='unfinished task')
        self.assertTrue(receipt['persisted'])
        self.assertTrue(receipt['safeToContinue'])
        self.assertEqual(self.flushes, [])
        self.assertEqual(self.notifications, [True])
        self.assertEqual(agent._session_messages, self.after)
        self.assertEqual(json.dumps(self.history), before)
        self.assertEqual(self.calls[0]['task_id'], 'original-native-session')
        self.assertTrue(self.calls[0]['request'].partial)
        self.assertEqual(after, self.after)

    def test_only_native_successor_is_used_and_flushed(self):
        self.mode = 'rotate'
        agent, receipt, _ = self.compress()
        self.assertEqual(receipt['sessionId'], 'official-successor-session')
        self.assertEqual(self.flushes, [(self.after, None)])
        self.assertEqual(self.notifications, [True])

    def test_failed_official_persistence_cannot_be_reported_committed_or_continue(self):
        self.mode = 'rotate'
        self.Agent._flush_messages_to_session_db = lambda agent, messages, conversation_history=None: False
        with self.assertRaisesRegex(bridge.OfficialCompressionError, 'PERSISTENCE_FAILED'):
            self.compress()
        self.assertEqual(self.notifications, [False])
        self.calls.clear()
        self.notifications.clear()
        agent = self.Agent()
        agent._incremental_persistence_failed = True
        with self.assertRaisesRegex(bridge.OfficialCompressionError, 'PERSISTENCE_FAILED'):
            bridge.compress_agent(agent, self.history, native_root=self.root)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.notifications, [])

    def test_preview_never_installs_or_flushes(self):
        agent, receipt, after = self.compress(preview=True)
        self.assertTrue(receipt['preview'])
        self.assertFalse(receipt['persisted'])
        self.assertFalse(receipt['safeToContinue'])
        self.assertEqual(after, self.history)
        self.assertEqual(self.notifications, [])
        self.assertEqual(self.flushes, [])

    def test_noop_aborted_refused_or_held_lock_do_not_continue(self):
        for mode in ['noop', 'aborted', 'refused', 'lock']:
            with self.subTest(mode=mode):
                self.mode = mode
                self.notifications.clear()
                _, receipt, after = self.compress()
                self.assertFalse(receipt['safeToContinue'])
                self.assertFalse(receipt['persisted'])
                self.assertEqual(after, self.history)
                self.assertEqual(self.notifications, [False])

    def test_deterministic_fallback_is_honestly_committed_but_not_auto_resumed(self):
        self.mode = 'fallback'
        _, receipt, _ = self.compress()
        self.assertTrue(receipt['persisted'])
        self.assertTrue(receipt['fallbackUsed'])
        self.assertFalse(receipt['safeToContinue'])
        self.assertEqual(self.notifications, [True])

    def test_same_process_continues_remaining_task_once(self):
        self.install()
        agent = self.Agent()
        result = agent.run_conversation('ORIGINAL_TASK_DO_NOT_REPLAY', task_id='same-action-task')
        self.assertTrue(result['completed'])
        self.assertEqual(len(agent.seen), 2)
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn('ORIGINAL_TASK_DO_NOT_REPLAY', agent.seen[1]['prompt'])
        self.assertEqual(agent.seen[1]['history'], self.after)
        self.assertEqual(agent.seen[1]['task_id'], 'same-action-task')
        self.assertTrue(result['ziwei_context_recovery']['continued'])

    def test_a_second_overflow_is_not_retried_again(self):
        self.mode = 'twice'
        self.install()
        agent = self.Agent()
        result = agent.run_conversation('one')
        self.assertTrue(result['compression_exhausted'])
        self.assertEqual(len(agent.seen), 2)
        self.assertEqual(len(self.calls), 1)

    def test_quoted_english_failure_without_typed_flags_never_triggers(self):
        def original(agent, query, **kwargs):
            return {'completed': True, 'final_response': "This conversation has grown too long; couldn't shrink", 'messages': self.history}
        self.Agent.run_conversation = original
        self.install()
        result = self.Agent().run_conversation('quote')
        self.assertTrue(result['completed'])
        self.assertEqual(self.calls, [])

    def test_typed_temporarily_deferred_result_never_forces_compression(self):
        def original(agent, query, **kwargs):
            return {'completed': False, 'compression_deferred': True, 'compression_exhausted': True, 'messages': self.history}
        self.Agent.run_conversation = original
        self.install()
        self.Agent().run_conversation('one')
        self.assertEqual(self.calls, [])

    def test_unanswered_parallel_call_blocks_compression(self):
        self.history[1]['tool_calls'].append({'id': 'pending-second-call'})
        self.install()
        agent = self.Agent()
        result = agent.run_conversation('one')
        self.assertTrue(result['compression_exhausted'])
        self.assertEqual(len(agent.seen), 1)
        self.assertEqual(self.calls, [])

    def test_unknown_external_receipt_and_running_background_both_block(self):
        for external, background in [(False, True), (True, False)]:
            with self.subTest(external=external, background=background):
                original = self.Agent.run_conversation
                bridge.install(self.root, agent_class=self.Agent, external_ready=lambda: external, background_idle=lambda: background)
                self.Agent().run_conversation('one')
                self.Agent.run_conversation = original
                self.assertEqual(self.calls, [])

    def test_real_phone_audit_guard_blocks_untracked_mutations_and_unknown_tools(self):
        audit = self.root / 'phone-audit.jsonl'
        for name in ('ziwei_phone_control', 'ziwei_enrollment_approve', 'unknown_tool'):
            with self.subTest(tool=name):
                audit.write_text(json.dumps({'method': 'initialize', 'ok': True}) + '\n' +
                                 json.dumps({'method': 'tools/call', 'toolName': name, 'ok': True}) + '\n')
                original = self.Agent.run_conversation
                with patch.dict(os.environ, {'ZIWEI_TERMINAL_AUDIT_FILE': str(audit), 'ZIWEI_MCP_AUDIT_FILE': ''}):
                    bridge.install(self.root, agent_class=self.Agent, background_idle=lambda: True)
                    agent = self.Agent()
                    result = agent.run_conversation('one')
                self.Agent.run_conversation = original
                self.assertTrue(result['compression_exhausted'])
                self.assertEqual(len(agent.seen), 1)
                self.assertEqual(self.calls, [])

    def test_original_stop_and_pending_maintenance_take_priority(self):
        settings = self.root / 'maintenance.json'
        settings.write_text(json.dumps({'directory': str(self.root)}))
        (self.root / 'request.json').write_text('{}')
        self.install(maintenance_control=str(settings))
        agent = self.Agent()
        agent.run_conversation('one')
        self.assertEqual(self.calls, [])
        (self.root / 'request.json').unlink()
        agent = self.Agent()
        agent._interrupt_requested = True
        agent.run_conversation('one')
        self.assertEqual(self.calls, [])

    def test_cancel_during_summary_commits_no_new_business_turn(self):
        self.mode = 'cancel_during'
        self.install()
        agent = self.Agent()
        result = agent.run_conversation('one')
        self.assertEqual(len(agent.seen), 1)
        self.assertFalse(result['ziwei_context_recovery']['safeToContinue'])
        self.assertEqual(self.notifications, [True])

    def test_unsupported_manual_core_signature_does_not_start_summary(self):
        def unsupported(agent):
            raise AssertionError('MUST_NOT_RUN')
        self.manual.compress_now = unsupported
        with self.assertRaisesRegex(bridge.OfficialCompressionError, 'UNSUPPORTED'):
            self.compress()
        self.assertEqual(self.calls, [])

    def test_provider_exception_is_redacted_and_not_followed_by_business_turn(self):
        self.mode = 'exception'
        self.install()
        agent = self.Agent()
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            result = agent.run_conversation('one')
        self.assertNotIn('SECRET', output.getvalue())
        self.assertNotIn('SECRET', json.dumps(result))
        self.assertEqual(len(agent.seen), 1)
        self.assertEqual(result['ziwei_context_recovery']['code'], 'HERMES_OFFICIAL_COMPRESSION_FAILED')

    def test_a_followup_exception_is_not_relabelled_as_unstarted_recovery(self):
        self.mode = 'continuation_exception'
        self.install()
        agent = self.Agent()
        with self.assertRaisesRegex(RuntimeError, 'follow-up failed after tools'):
            agent.run_conversation('one')
        self.assertEqual(len(agent.seen), 2)
        self.assertEqual(len(self.calls), 1)

    def test_explicit_session_compression_uses_official_cli_without_running_business_turn(self):
        test = self
        ctor = []
        closed = []

        class CLI:
            def __init__(self, *, resume, model, provider, toolsets, restore_cwd=True):
                ctor.append({'resume': resume, 'model': model, 'provider': provider, 'toolsets': toolsets, 'restore_cwd': restore_cwd})
                self.session_id = resume
                self.conversation_history = test.history
                self.agent = test.Agent()
                self._session_db = types.SimpleNamespace(close=lambda: closed.append('database'))

            def _ensure_runtime_credentials(self):
                return True

            def _init_agent(self):
                self.agent.close = lambda: closed.append('agent')
                return True

        cli_module = types.ModuleType('cli')
        cli_module.__file__ = str(self.root / 'cli.py')
        cli_module.HermesCLI = CLI
        config = types.ModuleType('hermes_cli.config')
        config.__file__ = str(self.root / 'hermes_cli/config.py')
        config.load_config = lambda: {'model': {'provider': 'openai-codex', 'default': 'gpt-6.1-sol'}, 'platform_toolsets': {'cli': ['terminal', 'ziwei-terminal']}}
        with patch.dict(sys.modules, {'cli': cli_module, 'hermes_cli.config': config}), patch.dict(os.environ, {'HERMES_HOME': str(self.root)}):
            receipt = bridge.compress_session({'sessionId': 'original-native-session'}, {'model': 'gpt-6.1-sol'}, native_root=self.root)
        self.assertTrue(receipt['safeToContinue'])
        self.assertFalse(ctor[0]['restore_cwd'])
        self.assertEqual(ctor[0]['toolsets'], ['terminal', 'ziwei-terminal'])
        self.assertEqual(self.calls[0]['agent'].seen, [])
        self.assertEqual(closed, ['agent', 'database'])

    def test_explicit_compression_rejects_silently_replaced_native_session(self):
        test = self

        class CLI:
            def __init__(self, *, resume, model, provider, toolsets, restore_cwd=True):
                self.session_id = resume
                self.conversation_history = test.history
                self.agent = None

            def _ensure_runtime_credentials(self):
                return True

            def _init_agent(self):
                self.agent = test.Agent()
                self.agent.session_id = 'unexpected-new-native-session'

        cli_module = types.ModuleType('cli')
        cli_module.__file__ = str(self.root / 'cli.py')
        cli_module.HermesCLI = CLI
        config = types.ModuleType('hermes_cli.config')
        config.__file__ = str(self.root / 'hermes_cli/config.py')
        config.load_config = lambda: {'model': {'default': 'gpt-6.1-sol'}}
        with patch.dict(sys.modules, {'cli': cli_module, 'hermes_cli.config': config}), patch.dict(os.environ, {'HERMES_HOME': str(self.root)}):
            with self.assertRaisesRegex(bridge.OfficialCompressionError, 'SESSION_MISMATCH'):
                bridge.compress_session({'sessionId': 'original-native-session'}, {}, native_root=self.root)
        self.assertEqual(self.calls, [])

    def test_does_not_use_custom_summary_or_direct_transcript_sql(self):
        source = (ROOT / 'src/hermes-official-compression.py').read_text()
        self.assertNotIn('import sqlite3', source)
        self.assertNotIn('create_session(', source)
        self.assertNotIn('DELETE FROM', source)
        self.assertNotIn('UPDATE messages', source)


if __name__ == '__main__':
    unittest.main(verbosity=2)
