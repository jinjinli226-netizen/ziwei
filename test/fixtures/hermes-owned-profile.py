"""Actual installed Hermes layout/resolver; temporary roots and no model/network."""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

class OwnedProfile(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='e02-owned-native-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        env=patch.dict(os.environ,{'HERMES_HOME':str(self.root)})
        env.start();self.addCleanup(env.stop)
        (self.root/'config.yaml').write_text('model:\n  provider: openai\n  default: fixture\n')
        (self.root/'auth.json').write_text('SOURCE AUTH UNCHANGED')
        (self.root/'.env').write_text('OPENAI_API_KEY=fixture-only\n')
        module=Path(__file__).resolve().parents[2]/'src/hermes-owned-profile.py'
        self.assertTrue(module.exists(),'owned-profile native provisioner is required')
        spec=importlib.util.spec_from_file_location('owned_profile',module)
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)

    def request(self,name='bot-first'):
        context={'employeeId':'employee_'+name,'workspace':'fixture','deviceId':'fixture-pc','name':name,'sourceProfile':name,'instance':{'mode':'owned_profile','profile':name,'templateProfile':'default','ownershipId':'owner-'+name,'provisionActionId':'action_'+name}}
        metadata={'version':1,'templateId':'ziwei-hermes-bot','key':'owner-'+name,'origin':'http://127.0.0.1:1','workspace':'fixture','employeeId':context['employeeId'],'sourceHome':str(self.root.resolve()),'sourceProfile':name,'mode':'owned_profile','profile':name,'templateProfile':'default','deviceId':'fixture-pc','provisionActionId':'action_'+name}
        return{'context':context,'metadata':metadata,'seedConfig':{'model':{'provider':'openai','default':'fixture'},'mcp_servers':{},'updates':{'check':False}},'authentication':'configured'}

    def test_two_named_profiles_resolve_to_owned_homes(self):
        from hermes_cli.profiles import get_profile_dir,profile_exists
        first=self.module.provision(self.request());second=self.module.provision(self.request('bot-second'))
        self.assertNotEqual(first['home'],second['home'])
        for result in [first,second]:
            self.assertEqual(Path(result['home']),get_profile_dir(result['profile']).resolve())
            self.assertEqual(result['home'],result['profileHome'])
            self.assertTrue(profile_exists(result['profile']))
            self.assertFalse((Path(result['home'])/'auth.json').exists())
            self.assertNotIn('fixture-only',(Path(result['home'])/'.env').read_text())
        self.assertEqual((self.root/'auth.json').read_text(),'SOURCE AUTH UNCHANGED')
        self.assertEqual((self.root/'.env').read_text(),'OPENAI_API_KEY=fixture-only\n')

    def test_duplicate_preserves_native_config_and_memory(self):
        request=self.request();first=self.module.provision(request);home=Path(first['home'])
        (home/'memories/MEMORY.md').write_text('FIRST MEMORY')
        config=(home/'config.yaml').read_text()+'\n# retained user setting\n';(home/'config.yaml').write_text(config)
        again=self.module.provision(request)
        self.assertTrue(again['duplicate']);self.assertEqual(again['home'],first['home'])
        self.assertEqual((home/'config.yaml').read_text(),config)
        self.assertEqual((home/'memories/MEMORY.md').read_text(),'FIRST MEMORY')
        request['metadata']['deviceId']='wrong-pc'
        with self.assertRaisesRegex(RuntimeError,'BOT_PROFILE_'):self.module.provision(request)

    def test_owned_profile_cannot_be_another_bots_template(self):
        first=self.module.provision(self.request());request=self.request('bot-nested')
        request['context']['instance']['templateProfile']='bot-first'
        request['metadata'].update(templateProfile='bot-first',sourceHome=first['home'])
        with self.assertRaisesRegex(RuntimeError,'BOT_PROFILE_TEMPLATE_UNSUPPORTED'):self.module.provision(request)
        self.assertFalse((self.root/'profiles/bot-nested').exists())

    def test_unowned_directory_is_never_adopted(self):
        home=self.root/'profiles/bot-first';home.mkdir(parents=True);(home/'config.yaml').write_text('USER DATA')
        with self.assertRaisesRegex(RuntimeError,'BOT_PROFILE_'):self.module.provision(self.request())
        self.assertEqual((home/'config.yaml').read_text(),'USER DATA')

    def test_owned_bootstrap_refuses_both_native_auth_write_paths(self):
        request=self.request();result=self.module.provision(request)
        bootstrap=Path(__file__).resolve().parents[2]/'src/hermes-mcp-bootstrap.py'
        env={**os.environ,'ZIWEI_CREATOR_HOME':result['home'],'ZIWEI_CREATOR_SOURCE_HOME':str(self.root),
             'ZIWEI_CREATOR_KEY':'owner-bot-first','ZIWEI_CREATOR_WORKSPACE':'fixture',
             'ZIWEI_CREATOR_EMPLOYEE_ID':'employee_bot-first','ZIWEI_CREATOR_PROFILE':'bot-first',
             'ZIWEI_INSTANCE_KIND':'hermes-bot','ZIWEI_BOT_PROFILE_MODE':'owned_profile','PYTHONDONTWRITEBYTECODE':'1'}
        program='''import importlib.util,sys,json,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('bootstrap',sys.argv[1])
bootstrap=importlib.util.module_from_spec(spec);spec.loader.exec_module(bootstrap)
current=bootstrap.binding(Path(sys.executable).with_name('hermes.exe'))
bootstrap.prepare_creator_home(current)
from hermes_cli import auth,auth_codex
assert auth._auth_file_path()==Path(os.environ['ZIWEI_CREATOR_SOURCE_HOME'])/'auth.json'
blocked=[]
for name,write in [('auth',auth._save_auth_store),('codex',auth_codex._save_codex_tokens)]:
 try:write({})
 except bootstrap.UnsupportedNativeHermes:blocked.append(name)
assert blocked==['auth','codex']
print(json.dumps({'blocked':blocked}))
'''
        before=(self.root/'auth.json').read_bytes()
        completed=subprocess.run([sys.executable,'-c',program,str(bootstrap)],env=env,capture_output=True,text=True,timeout=30)
        self.assertEqual(completed.returncode,0,completed.stderr)
        self.assertEqual(json.loads(completed.stdout)['blocked'],['auth','codex'])
        self.assertEqual((self.root/'auth.json').read_bytes(),before)
        self.assertFalse((Path(result['home'])/'auth.json').exists())

if __name__=='__main__':unittest.main(verbosity=2)
