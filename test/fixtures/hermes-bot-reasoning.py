"""Installed native reasoning conversion; isolated config and no provider calls."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import types
import unittest
from unittest.mock import patch


class Reasoning(unittest.TestCase):
    def setUp(self):
        file=Path(__file__).resolve().parents[2]/'src/hermes-bot-reasoning.py'
        self.assertTrue(file.exists(),'native Bot effort guard is required')
        spec=importlib.util.spec_from_file_location('bot_reasoning',file)
        self.bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.bridge)
        import agent.transports.codex as transport
        self.transport=transport;original=transport._resolve_reasoning
        self.addCleanup(setattr,transport,'_resolve_reasoning',original)
        original_preflight=transport.ResponsesApiTransport.preflight_kwargs
        self.addCleanup(setattr,transport.ResponsesApiTransport,'preflight_kwargs',original_preflight)
        env=patch.dict(os.environ,{'ZIWEI_BOT_REASONING_EFFORT':'ultra'});env.start();self.addCleanup(env.stop)
        self.current={'paths':{'reasoning_transport':str(Path(transport.__file__).resolve())}}
        self.isolation={'employeeId':'employee_reasoning','revision':2}

    def config(self,raw='ultra',effective=None):
        value={'model':{'provider':'openai-codex','default':'gpt-6.1-sol'},'agent':{'reasoning_effort':raw}}
        loaded={**value,'agent':{'reasoning_effort':effective or raw}}
        return types.SimpleNamespace(read_raw_config=lambda:value,load_config=lambda:loaded)

    def install(self,config=None,preflight=True):
        return self.bridge.install(self.current,config or self.config(),self.isolation,preflight=preflight,reject=RuntimeError)

    def test_explicit_ultra_reports_actual_clamp_and_rejects_before_model(self):
        output=io.StringIO()
        with contextlib.redirect_stderr(output),self.assertRaisesRegex(RuntimeError,'BOT_REASONING_UNSATISFIED'):
            self.install()
        proof=json.loads(output.getvalue().split('ZIWEI_BOT_REASONING:')[1])
        self.assertEqual(proof['requested'],'ultra');self.assertEqual(proof['actual'],'xhigh')
        self.assertEqual(proof['phase'],'preflight');self.assertEqual(proof['status'],'mismatch')

    def test_managed_policy_cannot_change_an_explicit_effort(self):
        with self.assertRaisesRegex(RuntimeError,'BOT_REASONING_MANAGED_CONFLICT'):
            self.install(self.config(effective='high'))

    def test_matching_native_effort_is_reported_again_at_request_boundary(self):
        os.environ['ZIWEI_BOT_REASONING_EFFORT']='high';output=io.StringIO()
        with contextlib.redirect_stderr(output):
            proof=self.install(self.config(raw='high'))
            actual,enabled=self.transport._resolve_reasoning('gpt-6.1-sol',{'provider':'openai-codex','is_codex_backend':True,'reasoning_config':{'enabled':True,'effort':'high'}})
            self.transport.ResponsesApiTransport().preflight_kwargs({'model':'gpt-6.1-sol','instructions':'Synthetic QA only','input':[],'reasoning':{'effort':'high'},'store':False})
        self.assertEqual((actual,enabled),('high',True));self.assertEqual(proof['actual'],'high')
        events=[json.loads(line.split('ZIWEI_BOT_REASONING:')[1]) for line in output.getvalue().splitlines()]
        self.assertEqual([event['phase'] for event in events],['preflight','conversion','request'])
        self.assertTrue(all(event['revision']==2 and event['status']=='matched' for event in events))

    def test_no_explicit_value_keeps_native_default_and_installs_no_guard(self):
        os.environ.pop('ZIWEI_BOT_REASONING_EFFORT');original=self.transport._resolve_reasoning
        self.assertIsNone(self.install());self.assertIs(self.transport._resolve_reasoning,original)

    def test_later_native_request_cannot_switch_effort_after_preflight(self):
        os.environ['ZIWEI_BOT_REASONING_EFFORT']='high'
        with contextlib.redirect_stderr(io.StringIO()):self.install(self.config(raw='high'))
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit) as error:
            self.transport._resolve_reasoning('gpt-6.1-sol',{'provider':'openai-codex','is_codex_backend':True,'reasoning_config':{'enabled':True,'effort':'low'}})
        self.assertEqual(error.exception.code,125)

    def test_verified_exact_gpt61_sol_max_survives_native_clamp_and_final_kwargs(self):
        os.environ['ZIWEI_BOT_REASONING_EFFORT']='max';output=io.StringIO()
        with contextlib.redirect_stderr(output):
            proof=self.install(self.config(raw='max'))
            actual,enabled=self.transport._resolve_reasoning('gpt-6.1-sol',{'provider':'openai-codex','is_codex_backend':True,'reasoning_config':{'enabled':True,'effort':'max'}})
            wire=self.transport.ResponsesApiTransport().preflight_kwargs({'model':'gpt-6.1-sol','instructions':'Synthetic QA only','input':[],'reasoning':{'effort':actual},'store':False})
        self.assertEqual((actual,enabled),('max',True));self.assertEqual(wire['reasoning']['effort'],'max')
        self.assertEqual(proof['nativeActual'],'xhigh');self.assertEqual(proof['actual'],'max')
        self.assertEqual(proof['mode'],'verified_gpt61_sol_max')

    def test_verified_max_does_not_expand_another_model(self):
        os.environ['ZIWEI_BOT_REASONING_EFFORT']='max';config=self.config(raw='max')
        value=config.read_raw_config();value['model']['default']='gpt-6-sol'
        config=types.SimpleNamespace(read_raw_config=lambda:value,load_config=lambda:value)
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaisesRegex(RuntimeError,'BOT_REASONING_UNSATISFIED'):
            self.install(config)

    def test_final_native_kwargs_cannot_override_matched_max_or_model(self):
        os.environ['ZIWEI_BOT_REASONING_EFFORT']='max'
        with contextlib.redirect_stderr(io.StringIO()):self.install(self.config(raw='max'))
        for wire_model,wire_effort in [('gpt-6.1-sol','xhigh'),('gpt-6-sol','max')]:
            with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit) as error:
                self.transport.ResponsesApiTransport().preflight_kwargs({'model':wire_model,'instructions':'Synthetic QA only','input':[],'reasoning':{'effort':wire_effort},'store':False})
            self.assertEqual(error.exception.code,125)
        for extra in [{'reasoning':{'effort':'low'}},{'model':'gpt-6-sol'}]:
            with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
                self.transport.ResponsesApiTransport().preflight_kwargs({'model':'gpt-6.1-sol','instructions':'Synthetic QA only','input':[],'reasoning':{'effort':'max'},'store':False,'extra_body':extra})
        with contextlib.redirect_stderr(io.StringIO()):
            preserved=self.transport.ResponsesApiTransport().preflight_kwargs({'model':'gpt-6.1-sol','instructions':'Synthetic QA only','input':[],'reasoning':{'effort':'max'},'store':False,'extra_body':{'qa_marker':'synthetic-only'}})
        self.assertEqual(preserved['extra_body'],{'qa_marker':'synthetic-only'})

if __name__=='__main__':unittest.main(verbosity=2)
