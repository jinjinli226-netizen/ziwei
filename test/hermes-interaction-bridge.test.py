import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace

FILE = Path(__file__).resolve().parents[1] / 'src/hermes-interaction-bridge.py'


class InteractionTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('interaction', FILE)
        self.bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.bridge)
        self.binding = dict(workspaceId='w', employeeId='e', profile='bot-e', deviceId='d',
                            actionId='a', revision=3, controlEpoch=2)

    def test_secure_callback_never_publishes_answer(self):
        requests = []
        def exchange(request):
            requests.append(request)
            return dict(requestId=request['requestId'], state='answered', value={'password': 'synthetic-secret'})
        callback = self.bridge.create_callbacks(self.binding, exchange)['unlock']
        self.assertEqual(callback('local', 'Local vault'), 'synthetic-secret')
        self.assertNotIn('synthetic-secret', str(requests))
        self.assertEqual(requests[0]['kind'], 'vault_unlock')

    def test_mismatched_expired_and_cancelled_never_supply_secret(self):
        for response in [dict(requestId='wrong',state='answered',value={'code':'123'}),
                         dict(state='expired'), dict(state='cancelled')]:
            cb = self.bridge.create_callbacks(self.binding, lambda request: response)['code']
            self.assertEqual(cb('example.test', ''), '')

    def test_question_preserves_timeout_and_selection(self):
        def exchange(request):
            return dict(requestId=request['requestId'],state='answered',value={'answer':'first'})
        cb = self.bridge.create_callbacks(self.binding,exchange)['clarify']
        self.assertEqual(cb('Pick', ['first','second']), 'first')
        timeout = self.bridge.create_callbacks(self.binding,lambda request: dict(state='expired'))['clarify']
        self.assertIsNone(timeout('Pick', []))

    def test_invalid_binding_rejected_before_exchange(self):
        with self.assertRaises(self.bridge.InteractionUnsupported):
            self.bridge.create_callbacks({**self.binding,'revision':True}, lambda r: None)

    def test_approval_never_expands_native_scope(self):
        def exchange(request):
            return dict(requestId=request['requestId'],state='answered',value={'answer':'always'})
        cb = self.bridge.create_callbacks(self.binding,exchange)['approval']
        self.assertEqual(cb('command','description',allow_permanent=False), 'deny')

    def test_native_turn_callbacks_restore_and_unattended_stays_closed(self):
        root = Path('/synthetic-native').resolve()
        state = {'cron': False, 'unattended': False}
        slots = {'unlock_prompt': None, 'save_login_prompt': None, 'code_prompt': None}
        vault = SimpleNamespace(__file__=str(root/'agent/vault_backends/unlock.py'),can_prompt_here=lambda:False)
        for key in slots:
            setattr(vault,'get_'+key+'_callback',lambda k=key:slots[k])
            setattr(vault,'set_'+key+'_callback',lambda value,k=key:slots.__setitem__(k,value))
        terminal = SimpleNamespace(__file__=str(root/'tools/terminal_tool.py'),_get_approval_callback=lambda:None,set_approval_callback=lambda cb:None)
        approvals = SimpleNamespace(__file__=str(root/'tools/approval.py'),_presence=lambda cb=None:(None,False,False,False))
        context = SimpleNamespace(__file__=str(root/'tools/approval_context.py'),_is_cron_approval_context=lambda:state['cron'],_is_unattended_platform_approval_context=lambda:state['unattended'])
        browser = SimpleNamespace(__file__=str(root/'tools/browser_vault_tool.py'),browser_vault_save_login=lambda:'{"success":true,"identifier":"private-account","handle":"h"}')
        redacted=[]
        redact = SimpleNamespace(__file__=str(root/'agent/redact.py'),register_vault_redaction_value=redacted.append)
        class Agent:
            clarify_callback=None
            def run_conversation(self):
                if not state['cron'] and not state['unattended']:
                    assert vault.can_prompt_here()
                    assert approvals._presence()[1] is True
                    assert 'private-account' not in browser.browser_vault_save_login()
                    return slots['code_prompt']('example.test','')
                assert not vault.can_prompt_here()
                return 'native-unattended'
        original=Agent.run_conversation
        modules={'agent.vault_backends.unlock':vault,'tools.terminal_tool':terminal,'tools.approval':approvals,'tools.approval_context':context,'tools.browser_vault_tool':browser,'agent.redact':redact,'run_agent':SimpleNamespace(__file__=str(root/'run_agent.py'),AIAgent=Agent)}
        def exchange(request):
            return dict(requestId=request['requestId'],state='answered',value={'code':'synthetic-code'})
        with patch.object(self.bridge.importlib,'import_module',side_effect=modules.__getitem__):
            cleanup=self.bridge.install(root,self.binding,exchange)
            agent=Agent()
            self.assertEqual(agent.run_conversation(),'synthetic-code')
            self.assertEqual(redacted,['synthetic-code'])
            self.assertTrue(all(value is None for value in slots.values()))
            self.assertIsNone(agent.clarify_callback)
            state['cron']=True
            self.assertEqual(agent.run_conversation(),'native-unattended')
            cleanup()
            self.assertIs(Agent.run_conversation,original)


if __name__ == '__main__':
    unittest.main()
