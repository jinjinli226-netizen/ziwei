import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse, stringify} from 'yaml';
import {prepareHermesBotHome,ownedProfileMetadata} from '../src/hermes-bot-runtime.mjs';
import {spawnSync} from 'node:child_process';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-native-image-config-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'config.yaml'),stringify({model:{provider:'openai-codex',default:'template-chat'},image_gen:{provider:'template-image'}}));
  fs.writeFileSync(path.join(root,'auth.json'),'TEMPLATE_PRIVATE_AUTH');
  return {root,profile(name,image_gen){
    const home=path.join(root,'profiles',name);fs.mkdirSync(home,{recursive:true});
    const context={workspace:'image-test',employeeId:'employee_'+name,deviceId:'pc',revision:1,sourceProfile:name,name,model:'gpt-6.1-sol',
      config:{toolsets:['image_gen'],permissions:{mode:'execute'}},
      instance:{mode:'owned_profile',profile:name,templateProfile:'default',ownershipId:name+'-owner',provisionActionId:'action_'+name}};
    fs.writeFileSync(path.join(home,'ziwei-instance.json'),JSON.stringify(ownedProfileMetadata({context,sourceHome:root,apiBase:'https://fixture.invalid'})));
    fs.writeFileSync(path.join(home,'config.yaml'),stringify({model:{provider:'openai-codex',default:'gpt-6.1-sol'},...(image_gen?{image_gen}:{})}));
    fs.writeFileSync(path.join(home,'auth.json'),'PROFILE_PRIVATE_AUTH_'+name);
    fs.writeFileSync(path.join(home,'state.db'),'OWNED_HISTORY_'+name);
    return {context,sourceHome:home,privateDirectory:path.join(root,'unused'),workspace:'image-test',apiBase:'https://fixture.invalid'};
  }};
}

test('owned native image provider and model survive two real prepares without copying private settings or changing chat route',t=>{
  const f=fixture(t),settings={provider:'openai-codex',model:'gpt-image-2-medium','openai-codex':{model:'gpt-image-2-high',api_key:'SECRET_NESTED'},api_key:'SECRET_IMAGE',headers:{authorization:'SECRET_HEADER'}};
  const options=f.profile('bot-growth',settings);
  const first=prepareHermesBotHome(options);
  const second=prepareHermesBotHome({...options,context:{...options.context,revision:2}});
  const saved=parse(fs.readFileSync(path.join(second.home,'config.yaml'),'utf8'));
  assert.deepEqual(first.config.image_gen,{provider:settings.provider,model:settings.model,'openai-codex':{model:'gpt-image-2-high'}});
  assert.deepEqual(saved.image_gen,first.config.image_gen);
  assert.deepEqual(saved.model,first.config.model);
  assert.equal(saved.model.provider,'openai-codex');assert.equal(saved.model.default,'gpt-6.1-sol');
  assert.doesNotMatch(JSON.stringify(saved),/SECRET/);
  assert.equal(fs.readFileSync(path.join(second.home,'auth.json'),'utf8'),'PROFILE_PRIVATE_AUTH_bot-growth');
  assert.equal(fs.readFileSync(path.join(second.home,'state.db'),'utf8'),'OWNED_HISTORY_bot-growth');
  assert.equal(fs.readFileSync(path.join(f.root,'auth.json'),'utf8'),'TEMPLATE_PRIVATE_AUTH');
});

test('native image selection made between prepares is read next round and stays within its own Profile',t=>{
  const f=fixture(t),a=f.profile('bot-growth'),b=f.profile('bot-other',{provider:'openai',openai:{model:'gpt-image-2-low'}});
  const first=prepareHermesBotHome(a);prepareHermesBotHome(b);
  assert.equal(first.config.image_gen,undefined,'template image provider must not be borrowed');
  const configPath=path.join(first.home,'config.yaml'),native=parse(fs.readFileSync(configPath,'utf8'));
  native.image_gen={provider:'openai-codex','openai-codex':{model:'gpt-image-2-medium'}};
  fs.writeFileSync(configPath,stringify(native));
  const second=prepareHermesBotHome(a),other=prepareHermesBotHome(b);
  assert.deepEqual(second.config.image_gen,native.image_gen);
  assert.deepEqual(other.config.image_gen,{provider:'openai',openai:{model:'gpt-image-2-low'}});
});

const nativeReader=String.raw`
import importlib.util,json,os,pathlib,platform,sys
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
request=json.loads(sys.stdin.read());root=pathlib.Path(request['root']).resolve()
home=pathlib.Path(request['home']).resolve();native=pathlib.Path(request['nativeRoot']).resolve()
os.environ.update(HERMES_HOME=str(home),HERMES_MANAGED_DIR=str(root/'managed'),
 HOME=str(root/'user'),USERPROFILE=str(root/'user'),LOCALAPPDATA=str(root/'local'),APPDATA=str(root/'roaming'))
platform.uname()
def audit(event,args):
 if event.startswith(('socket.connect','socket.bind','socket.getaddrinfo','subprocess.','os.exec','os.spawn','os.system')):raise AssertionError('NO_NETWORK_OR_PROCESS')
 if event=='open' and not isinstance(args[0],int):
  name,mode,flags=args;file=pathlib.Path(name).resolve()
  if flags&(os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND) and not file.is_relative_to(root):raise AssertionError('NO_EXTERNAL_WRITE')
  if not file.is_relative_to(root) and file.name in ('.env','auth.json','state.db','ziwei_user.json'):raise AssertionError('NO_REAL_PRIVATE_READ')
sys.addaudithook(audit);sys.path.insert(0,str(native))
from hermes_cli.config import load_config,get_config_path
from tools.image_generation_tool import _plugin_provider_name,_read_configured_image_model
spec=importlib.util.spec_from_file_location('fixture_codex_image',native/'plugins/image_gen/openai-codex/__init__.py')
provider=importlib.util.module_from_spec(spec);spec.loader.exec_module(provider)
config=load_config()
print(json.dumps({'configPath':str(get_config_path()),'image':config.get('image_gen'),
 'selectedProvider':_plugin_provider_name(),'selectedModel':_read_configured_image_model(),
 'resolvedModel':provider._resolve_model()[0]}))
`;

test('installed Hermes image selectors read the owned settings after each real prepare without generation or private reads',t=>{
  const nativeRoot=process.env.ZIWEI_TEST_HERMES_ROOT;
  const python=process.env.ZIWEI_TEST_PYTHON;
  if(!nativeRoot||!python){t.skip('Set ZIWEI_TEST_HERMES_ROOT and ZIWEI_TEST_PYTHON for native no-network config verification');return;}
  const f=fixture(t),options=f.profile('bot-native-reader',{provider:'openai-codex',model:'gpt-image-2-low','openai-codex':{model:'gpt-image-2-medium'}});
  function nativeRead(home){
    const env={PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',TEMP:f.root,TMP:f.root};
    for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.env[key])env[key]=process.env[key];
    const result=spawnSync(python,['-I','-B','-c',nativeReader],{input:JSON.stringify({root:f.root,home,nativeRoot}),env,encoding:'utf8',windowsHide:true,timeout:20000});
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);return JSON.parse(result.stdout);
  }
  const first=prepareHermesBotHome(options),before=nativeRead(first.home);
  assert.equal(before.selectedProvider,'openai-codex');assert.equal(before.selectedModel,'gpt-image-2-low');assert.equal(before.resolvedModel,'gpt-image-2-medium');
  const file=path.join(first.home,'config.yaml'),selected=parse(fs.readFileSync(file,'utf8'));
  selected.image_gen['openai-codex'].model='gpt-image-2-high';fs.writeFileSync(file,stringify(selected));
  const second=prepareHermesBotHome({...options,context:{...options.context,revision:2}}),after=nativeRead(second.home);
  assert.deepEqual(after.image,second.config.image_gen);assert.equal(after.selectedProvider,'openai-codex');assert.equal(after.resolvedModel,'gpt-image-2-high');
  assert.equal(path.resolve(after.configPath),path.join(second.home,'config.yaml'));
});
