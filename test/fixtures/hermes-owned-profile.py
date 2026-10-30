"""Actual installed Hermes layout/resolver; temporary roots and no model/network."""
import importlib.util
import base64
from contextlib import closing
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

class OwnedProfile(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='e02-owned-native-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        env=patch.dict(os.environ,{'HERMES_HOME':str(self.root),'HERMES_MANAGED_DIR':str(self.root/'managed'),
                                  'HOME':str(self.root/'user'),'USERPROFILE':str(self.root/'user'),
                                  'LOCALAPPDATA':str(self.root/'local'),'APPDATA':str(self.root/'roaming')})
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

    def test_explicit_reasoning_is_saved_and_reported_without_claiming_wire_support(self):
        request=self.request();request['context']['config']={'reasoningEffort':'ultra'}
        request['seedConfig']['agent']={'reasoning_effort':'ultra'}
        result=self.module.provision(request)
        self.assertEqual(result['reasoning'],{'requested':'ultra','actual':None,'status':'configured'})
        import yaml
        self.assertEqual(yaml.safe_load((Path(result['home'])/'config.yaml').read_text())['agent']['reasoning_effort'],'ultra')

    def test_current_native_layout_keeps_template_and_existing_profile_untouched(self):
        from hermes_cli.profiles import NO_BUNDLED_SKILLS_MARKER,get_profile_dir
        from hermes_constants import get_hermes_home
        self.assertEqual(get_profile_dir('default').resolve(),self.root.resolve())
        self.assertEqual(get_hermes_home().resolve(),self.root.resolve())
        originals={name:(self.root/name).read_bytes() for name in ('config.yaml','auth.json','.env')}
        existing=self.root/'profiles'/'kept-profile';existing.mkdir(parents=True)
        memory=existing/'MEMORY.md';memory.write_text('EXISTING USER MEMORY',encoding='utf-8')
        result=self.module.provision(self.request())
        home=Path(result['home'])
        self.assertTrue((home/NO_BUNDLED_SKILLS_MARKER).is_file())
        self.assertTrue((home/'.env').is_file())
        for directory in ('memories','sessions','skills'):
            self.assertTrue((home/directory).is_dir(),directory)
        self.assertEqual(memory.read_text(encoding='utf-8'),'EXISTING USER MEMORY')
        for name,before in originals.items():
            self.assertEqual((self.root/name).read_bytes(),before,name)
        self.assertFalse(list(home.parent.glob('.bot-first.owned-*')))

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

    def tokens(self,label,fresh=False):
        claims=json.dumps({'sub':'fixture-'+label,'exp':4102444800 if fresh else 1},separators=(',',':')).encode()
        access='eyJhbGciOiJub25lIn0.'+base64.urlsafe_b64encode(claims).decode().rstrip('=')+'.fixture-signature'
        return {'access_token':access,'refresh_token':'fixture-'+label+('-rotated' if fresh else '-expired')}

    def seed_auth(self,label='shared',source=None):
        source=source or self.root
        old,fresh=self.tokens(label),self.tokens(label,True)
        (source/'auth.json').write_text(json.dumps({'version':1,'providers':{'openai-codex':{'tokens':old,'auth_mode':'chatgpt'}}}))
        (source/'.env').write_text('HTTP_PROXY=http://127.0.0.1:19001\nHTTPS_PROXY=http://127.0.0.1:19001\n')
        return old,fresh

    def auth_child(self,result,mode,old,fresh,source=None,**extra):
        source=source or self.root
        managed=self.root/'fixture-managed';managed.mkdir(exist_ok=True)
        env={key:value for key,value in os.environ.items() if key in {'PATH','SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','PYTHONPATH'}}
        env.update({'HERMES_HOME':str(source),'HERMES_MANAGED_DIR':str(managed),
                    'HOME':str(self.root/'empty-user'),'USERPROFILE':str(self.root/'empty-user'),'CODEX_HOME':str(self.root/'empty-codex'),
                    'ZIWEI_CREATOR_HOME':result['home'],'ZIWEI_CREATOR_SOURCE_HOME':str(source),
                    'ZIWEI_CREATOR_KEY':result['ownershipId'],'ZIWEI_CREATOR_WORKSPACE':'fixture',
                    'ZIWEI_CREATOR_EMPLOYEE_ID':result['employeeId'],'ZIWEI_CREATOR_PROFILE':result['profile'],
                    'ZIWEI_INSTANCE_KIND':'hermes-bot','ZIWEI_BOT_PROFILE_MODE':'owned_profile','PYTHONDONTWRITEBYTECODE':'1'})
        bootstrap=Path(__file__).resolve().parents[2]/'src/hermes-mcp-bootstrap.py'
        request={'mode':mode,'oldTokens':old,'freshTokens':fresh,'journal':str(self.root/'refresh-journal'),**extra}
        return subprocess.Popen([sys.executable,str(Path(__file__).with_name('hermes-source-auth-child.py')),str(bootstrap),json.dumps(request)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)

    def auth_result(self,process):
        try:stdout,stderr=process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill();process.communicate();self.fail('Synthetic native auth child timed out')
        self.assertEqual(process.returncode,0,stderr)
        return json.loads(stdout)

    def test_owned_bootstrap_preserves_native_source_save_paths_and_isolated_bot_state(self):
        result=self.module.provision(self.request());old,fresh=self.seed_auth()
        config=(Path(result['home'])/'config.yaml').read_bytes();env=(self.root/'.env').read_bytes()
        proof=self.auth_result(self.auth_child(result,'write',old,fresh))
        self.assertEqual(proof['refreshCalls'],0)
        self.assertEqual(len(proof['atomicWritePaths']),2)
        self.assertEqual((self.root/'.env').read_bytes(),env)
        self.assertEqual((Path(result['home'])/'config.yaml').read_bytes(),config)
        self.assertFalse((Path(result['home'])/'auth.json').exists())

    def test_two_bots_rotate_one_native_store_once_and_reuse_rotated_pair(self):
        results=[self.module.provision(self.request(name)) for name in ['bot-first','bot-second']]
        old,fresh=self.seed_auth();go=self.root/'go';ready=[self.root/('ready-'+str(index)) for index in range(2)]
        configs=[(Path(result['home'])/'config.yaml').read_bytes() for result in results]
        children=[self.auth_child(result,'stale',old,fresh,ready=str(ready[index]),go=str(go)) for index,result in enumerate(results)]
        try:
            deadline=time.monotonic()+20
            while not all(marker.exists() for marker in ready):
                self.assertTrue(all(process.poll() is None for process in children),'Synthetic child exited before refresh barrier')
                self.assertLess(time.monotonic(),deadline,'Synthetic refresh barrier timed out')
                time.sleep(0.02)
            go.touch()
            proofs=[self.auth_result(process) for process in children]
        finally:
            for process in children:
                if process.poll() is None:process.kill();process.communicate()
        self.assertEqual(sum(proof['refreshCalls'] for proof in proofs),1)
        self.assertEqual(len({proof['source'] for proof in proofs}),1)
        self.assertEqual(len({proof['home'] for proof in proofs}),2)
        again=self.auth_result(self.auth_child(results[1],'resolve',old,fresh))
        self.assertEqual(again['refreshCalls'],0)
        self.assertEqual((self.root/'refresh-journal').read_text().splitlines(),['refresh'])
        self.assertEqual(json.loads((self.root/'auth.json').read_text())['providers']['openai-codex']['tokens'],fresh)
        for index,result in enumerate(results):
            home=Path(result['home'])
            self.assertEqual((home/'config.yaml').read_bytes(),configs[index])
            self.assertEqual((home/'memories/MEMORY.md').read_text(),'MEMORY '+result['profile'])
            import sqlite3
            with closing(sqlite3.connect(home/'state.db')) as database:self.assertEqual(database.execute('SELECT name FROM fixture_identity').fetchall(),[(result['profile'],)])
            self.assertFalse((home/'auth.json').exists())

    def test_different_source_stores_never_reuse_another_sources_rotated_credentials(self):
        first=self.module.provision(self.request());old,fresh=self.seed_auth('source-one')
        self.auth_result(self.auth_child(first,'resolve',old,fresh))
        first_auth=(self.root/'auth.json').read_bytes()
        other=self.root/'other-source';other.mkdir();(other/'config.yaml').write_text('model:\n  provider: openai-codex\n  default: fixture\n')
        request=self.request('bot-other');request['metadata']['sourceHome']=str(other.resolve())
        with patch.dict(os.environ,{'HERMES_HOME':str(other)}):second=self.module.provision(request)
        other_old,other_fresh=self.seed_auth('source-two',other)
        proof=self.auth_result(self.auth_child(second,'resolve',other_old,other_fresh,source=other))
        self.assertEqual(proof['refreshCalls'],1)
        self.assertEqual(proof['accessDigest'],hashlib.sha256(other_fresh['access_token'].encode()).hexdigest())
        self.assertNotEqual(proof['accessDigest'],hashlib.sha256(fresh['access_token'].encode()).hexdigest())
        self.assertEqual((self.root/'auth.json').read_bytes(),first_auth)
        self.assertEqual(json.loads((other/'auth.json').read_text())['providers']['openai-codex']['tokens'],other_fresh)

    def test_invalid_grant_preserves_native_auth_error_and_original_source_store(self):
        result=self.module.provision(self.request());old,fresh=self.seed_auth('invalid-grant')
        before=(self.root/'auth.json').read_bytes()
        proof=self.auth_result(self.auth_child(result,'invalid_grant',old,fresh))
        self.assertEqual(proof['failure'],{'code':'invalid_grant','relogin_required':True})
        self.assertFalse(proof['credentialsResolved'])
        self.assertIsNone(proof['accessDigest'])
        self.assertEqual(proof['refreshCalls'],1)
        self.assertEqual(proof['externalLoginProbeCalls'],1)
        self.assertEqual(proof['atomicWritePaths'],[])
        self.assertEqual((self.root/'auth.json').read_bytes(),before)
        self.assertFalse((Path(result['home'])/'auth.json').exists())

if __name__=='__main__':unittest.main(verbosity=2)
