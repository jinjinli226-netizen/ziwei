import {rasterFixtures} from './fixtures/raster-images.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {hermesMcpSpawnSpec,runtimeInvocation,executeRuntime,resetRuntimeDiscovery} from '../src/runtime-adapters.mjs';

const pngs=[rasterFixtures.png,Buffer.concat([rasterFixtures.png,Buffer.from('\r\n')])];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function python(){for(const command of ['python3','python']){const p=spawnSync(command,['-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true});if(p.status===0&&path.isAbsolute(p.stdout.trim()))return p.stdout.trim();}return null;}
function fixture(t){
  const interpreter=python();if(!interpreter){t.skip('Python is needed for the isolated native fixture');return null;}
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-hermes-multi-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const write=(name,content)=>{const target=path.join(directory,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);return target;};
  write('hermes_cli/__init__.py','__version__="0.21.3"\n');write('agent/__init__.py','');
  write('hermes_cli/managed_scope.py','import os\nHERMES_MANAGED_DIR=os.environ.get("HERMES_MANAGED_DIR")\n');
  write('hermes_cli/config.py','def load_config():\n return {}\ndef read_raw_config():\n return {}\n');
  write('hermes_cli/mcp_startup.py','def _has_configured_mcp_servers():\n return False\n');
  write('hermes_cli/main.py',`import argparse,json,sys\ndef _read_query_file(args):\n if args.query_file:\n  args.query=sys.stdin.read()\ndef cmd_chat(args):\n _read_query_file(args)\n from cli import main as cli_main\n return cli_main(query=args.query,image=args.image,output_format=args.output_format)\ndef main():\n parser=argparse.ArgumentParser();parser.add_argument('--profile');parser.add_argument('--yolo',action='store_true');commands=parser.add_subparsers(dest='command');chat=commands.add_parser('chat');chat.add_argument('--query-file');chat.add_argument('-q','--query');chat.add_argument('--image');chat.add_argument('--format',dest='output_format',default='text');chat.add_argument('--model');chat.add_argument('-Q',action='store_true');args=parser.parse_args();return cmd_chat(args)\n`);
  write('cli.py',`import base64,json,os\nfrom pathlib import Path\nfrom types import SimpleNamespace\ndef _collect_query_images(query,image_arg=None):\n return query or '',[Path(image_arg)] if image_arg else []\ndef _route_single_query_images(cli,query,effective_query,single_query_images,single_query_image_urls):\n from agent.image_routing import build_native_content_parts\n return build_native_content_parts(query,[str(p) for p in single_query_images])[0]\ndef main(query=None,image=None,output_format='text'):\n text,paths=_collect_query_images(query,image);message=_route_single_query_images(SimpleNamespace(provider='fixture',model='fixture',requested_provider='fixture'),text,text,paths,[])\n marker=Path(os.environ['HERMES_HOME'])/'agent-invoked';marker.write_text('fixture agent called; no model/network')\n receipt={'type':'result','user_message':message,'modelCalls':0,'query':query,'managed':os.environ.get('HERMES_MANAGED_DIR')};receipt['text']=json.dumps(receipt);print(json.dumps(receipt));return 0\n`);
  write('agent/image_routing.py',`import base64,os\nfrom pathlib import Path\ndef decide_image_input_mode(provider,model,cfg,*,requested_provider=''):\n return 'text' if os.environ.get('FIXTURE_TEXT_MODEL') else 'native'\ndef build_native_content_parts(user_text,image_paths,image_urls=None):\n paths=list(image_paths)\n if os.environ.get('FIXTURE_REORDER'):paths.reverse()\n skipped=[]\n if os.environ.get('FIXTURE_SKIP'):skipped.append(paths.pop())\n parts=[{'type':'text','text':user_text}]+[{'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(Path(p).read_bytes()).decode()}} for p in paths]\n if os.environ.get('FIXTURE_DROP'):parts.pop()\n if os.environ.get('FIXTURE_TEXT_PARTS'):parts=[{'type':'text','text':user_text}]\n return parts,skipped\n`);
  const launcher=write('hermes',`#!"${interpreter}"\nfrom hermes_cli.main import main\nif __name__=='__main__':\n main()\n`),home=path.join(directory,'home'),overlay=path.join(directory,'managed');fs.mkdirSync(home);fs.mkdirSync(overlay);fs.writeFileSync(path.join(home,'auth.json'),'synthetic-original-auth');
  const images=pngs.map((bytes,index)=>{const filename=write(`images/input ${index}.png`,bytes);return{path:filename,size:bytes.length,sha256:sha(bytes)};});
  const env={...process.env,PYTHONPATH:directory,HERMES_HOME:home,HERMES_MANAGED_DIR:overlay};for(const key of ['ZIWEI_CREATOR_HOME','ZIWEI_INSTANCE_KIND','ZIWEI_BOT_PROFILE_MODE','ZIWEI_BOT_REASONING_EFFORT','ZIWEI_EXECUTION_PROFILE_BOUND'])delete env[key];
  const prompt='Compare both images. Keep quotes " and $(text) and Unicode 图片.\nSecond line.';
  const args=['--profile','selected','chat','--query-file','-','--format','stream-json'];
  const spec=()=>hermesMcpSpawnSpec(launcher,args,{env,inputImages:images});
  const run=(selected=spec(),extra={})=>spawnSync(selected.command,selected.args,{env:{...env,...extra},input:prompt,encoding:'utf8',windowsHide:true});
  return{interpreter,directory,home,launcher,images,env,prompt,args,spec,run,write};
}

test('Hermes multi-image invocation cannot collapse repeated flags; native user content retains bytes and order in one message',t=>{
  const f=fixture(t);if(!f)return;
  const invocation=runtimeInvocation('Hermes',{prompt:f.prompt,attachments:f.images.map(item=>({path:item.path,mimeType:'image/png'}))});
  assert.equal(invocation.args.includes('--image'),false);assert.equal(invocation.stdin,f.prompt);assert.equal(invocation.format,'json-lines');assert.deepEqual(invocation.inputImages,f.images.map(item=>item.path));
  const spec=f.spec();assert.equal(spec.args.includes('--input-images'),true);assert.equal(spec.args.filter(arg=>arg==='--image').length,0);
  const result=f.run(spec);assert.equal(result.status,0,result.stderr);const receipt=JSON.parse(result.stdout);assert.equal(receipt.modelCalls,0);assert.equal(receipt.query,f.prompt);
  assert.equal(receipt.user_message[0].type,'text');assert.equal(receipt.user_message.length,3);
  assert.deepEqual(receipt.user_message.slice(1).map(part=>sha(Buffer.from(part.image_url.url.split(',')[1],'base64'))),f.images.map(item=>item.sha256));
  assert.equal(fs.readFileSync(path.join(f.home,'auth.json'),'utf8'),'synthetic-original-auth');
  // The unmodified native parser is scalar: this baseline demonstrates the original last-image loss.
  const legacy=hermesMcpSpawnSpec(f.launcher,[...f.args,'--image',f.images[0].path,'--image',f.images[1].path],{env:f.env}),single=f.run(legacy);
  assert.equal(single.status,0,single.stderr);const native=JSON.parse(single.stdout);assert.equal(native.user_message.length,2);assert.equal(sha(Buffer.from(native.user_message[1].image_url.url.split(',')[1],'base64')),f.images[1].sha256);
});

test('multi-image missing or changed files fail before the fixture agent without text-only degradation',t=>{
  for(const kind of ['missing','changed']){
    const f=fixture(t);if(!f)return;const spec=f.spec();
    if(kind==='missing')fs.rmSync(f.images[1].path);else fs.writeFileSync(f.images[1].path,pngs[0]);
    const result=f.run(spec);assert.equal(result.status,125,result.stderr);assert.equal(fs.existsSync(path.join(f.home,'agent-invoked')),false);assert.equal(fs.readFileSync(path.join(f.home,'auth.json'),'utf8'),'synthetic-original-auth');
  }
});

test('non-native models, skipped, dropped, reordered and text-only native output all fail before agent execution',t=>{
  for(const flag of ['FIXTURE_TEXT_MODEL','FIXTURE_SKIP','FIXTURE_DROP','FIXTURE_REORDER','FIXTURE_TEXT_PARTS']){
    const f=fixture(t);if(!f)return;const result=f.run(f.spec(),{[flag]:'1'});assert.equal(result.status,125,flag+': '+result.stderr);assert.equal(fs.existsSync(path.join(f.home,'agent-invoked')),false,flag);
  }
});

test('multi-image source shape and fingerprints are required only for the new route',t=>{
  const f=fixture(t);if(!f)return;const spec=f.spec();fs.appendFileSync(path.join(f.directory,'agent/image_routing.py'),'\n# changed image implementation\n');const changed=f.run(spec);assert.equal(changed.status,125);assert.equal(fs.existsSync(path.join(f.home,'agent-invoked')),false);
  f.write('cli.py','def main(**kwargs):\n return 0\n');
  assert.throws(()=>f.spec(),/Hermes.*兼容|Hermes.*更新/);
  assert.doesNotThrow(()=>hermesMcpSpawnSpec(f.launcher,f.args,{env:f.env}));
  const one=runtimeInvocation('Hermes',{prompt:'one image',attachments:[{path:f.images[0].path,mimeType:'image/png'}]});assert.equal(one.args.filter(arg=>arg==='--image').length,1);assert.equal(one.stdin,null);const plain=runtimeInvocation('Hermes',{prompt:'no image'});assert.deepEqual(plain.args,['--yolo','chat','--query-file','-','--format','stream-json']);assert.equal(plain.stdin,'no image');assert.equal(plain.format,'json-lines');
});

test('multi-image transport rejects unsafe counts and duplicate native image flags',t=>{
  const f=fixture(t);if(!f)return;
  assert.throws(()=>hermesMcpSpawnSpec(f.launcher,f.args,{env:f.env,inputImages:[f.images[0]]}),/2–20/);
  assert.throws(()=>runtimeInvocation('Hermes',{prompt:'too many',attachments:Array.from({length:21},()=>({path:f.images[0].path,mimeType:'image/png'}))}),/20/);
  const spec=hermesMcpSpawnSpec(f.launcher,[...f.args,'--image',f.images[0].path],{env:f.env,inputImages:f.images}),result=f.run(spec);assert.equal(result.status,125);assert.equal(fs.existsSync(path.join(f.home,'agent-invoked')),false);
});

test('installed Hermes native content builder receives the ordered image bytes without importing auth or starting a model',t=>{
  const nativeRoot=path.join(os.homedir(),'.hermes','hermes-agent');if(!fs.existsSync(path.join(nativeRoot,'agent','image_routing.py'))){t.skip('Installed native source is unavailable; isolated transport tests still cover the contract');return;}
  const f=fixture(t);if(!f)return;
  const script=String.raw`import ast,base64,hashlib,importlib.util,json,sys,types,__future__
from pathlib import Path
bootstrap,root,manifest=sys.argv[1:];root=Path(root)
spec=importlib.util.spec_from_file_location('ziwei_bootstrap_fixture',bootstrap);bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
def functions(filename,names,namespace):
 tree=ast.parse(Path(filename).read_text());nodes=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in names]
 assert len(nodes)==len(names)
 exec(compile(ast.Module(body=nodes,type_ignores=[]),str(filename),'exec',flags=__future__.annotations.compiler_flag),namespace)
routing=types.ModuleType('agent.image_routing');routing.__file__=str(root/'agent/image_routing.py')
routing.__dict__.update(Path=Path,base64=base64,logger=types.SimpleNamespace(warning=lambda *a:None,info=lambda *a:None),_guess_mime=lambda p,raw=None:'image/png',_accepted_mimes=lambda:{'image/png'})
functions(routing.__file__,{'_file_to_data_url','build_native_content_parts'},routing.__dict__)
routing.decide_image_input_mode=lambda *a,**kw:'native'
safety=types.ModuleType('agent.file_safety');safety.raise_if_read_blocked=lambda p:None
cli=types.ModuleType('cli');cli.__file__=str(root/'cli.py');cli.Path=Path
functions(cli.__file__,{'_collect_query_images','_route_single_query_images'},cli.__dict__)
cfg=types.ModuleType('hermes_cli.config');cfg.load_config=lambda:{}
sys.modules.update({'cli':cli,'agent.image_routing':routing,'agent.file_safety':safety,'hermes_cli.config':cfg})
native=types.SimpleNamespace(_read_query_file=lambda args:setattr(args,'query','Compare both actual image contents.'))
descriptors=json.loads(manifest);bridge.install_multi_image_input(native,{'paths':{'image_cli':cli.__file__,'image_routing':routing.__file__}},descriptors)
args=types.SimpleNamespace(output_format='stream-json',query=None,image=None,tui=False);native._read_query_file(args)
text,paths=cli._collect_query_images(args.query,None)
content=cli._route_single_query_images(types.SimpleNamespace(provider='fixture',model='fixture',requested_provider='fixture'),text,text,paths,[])
hashes=[hashlib.sha256(base64.b64decode(p['image_url']['url'].split(',')[1])).hexdigest() for p in content if p['type']=='image_url']
assert hashes==[item['sha256'] for item in descriptors]
print(json.dumps({'imageHashes':hashes,'textParts':sum(p['type']=='text' for p in content),'modelCalls':0,'nativeBuilderSource':routing.__file__}))
`;
  const result=spawnSync(f.interpreter,['-c',script,path.resolve('src/hermes-mcp-bootstrap.py'),nativeRoot,JSON.stringify(f.images)],{env:f.env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);
  const proof=JSON.parse(result.stdout);assert.deepEqual(proof.imageHashes,f.images.map(item=>item.sha256));assert.equal(proof.textParts,1);assert.equal(proof.modelCalls,0);
});

async function executeImageFixture(t,{globalPolicy=false}={}){
  const f=fixture(t);if(!f)return;
  // Model native CLI sticky selection only when no explicit profile was supplied.
  const nativeMain=path.join(f.directory,'hermes_cli/main.py');
  fs.writeFileSync(nativeMain,fs.readFileSync(nativeMain,'utf8').replace('import argparse,json,sys','import argparse,json,sys,os\nfrom pathlib import Path').replace('args=parser.parse_args();return cmd_chat(args)',"args=parser.parse_args()\n home=Path(os.environ['HERMES_HOME']);sticky=home/'active_profile'\n selected=args.profile or (sticky.read_text().strip() if sticky.is_file() else 'default')\n os.environ['FIXTURE_SELECTED_PROFILE']=selected\n if args.profile is None and selected!='default':os.environ['HERMES_HOME']=str(home/'profiles'/selected)\n return cmd_chat(args)"));
  const nativeCli=path.join(f.directory,'cli.py');
  fs.writeFileSync(nativeCli,fs.readFileSync(nativeCli,'utf8').replace("'managed':os.environ.get('HERMES_MANAGED_DIR')","'managed':os.environ.get('HERMES_MANAGED_DIR'),'profile':os.environ.get('FIXTURE_SELECTED_PROFILE'),'sourceHome':os.environ['HERMES_HOME'],'managedConfig':Path(os.environ['HERMES_MANAGED_DIR'],'config.yaml').read_text()"));
  f.write('which',`#!${process.execPath}\nif(process.argv[2]==='hermes')process.stdout.write(${JSON.stringify(f.launcher)}+'\\n');else process.exitCode=1;\n`);fs.chmodSync(path.join(f.directory,'which'),0o755);fs.chmodSync(f.launcher,0o755);
  fs.writeFileSync(path.join(f.home,'config.yaml'),'model:\n  provider: ollama\n  default: fixture-model\n');
  const policy=path.join(f.directory,'inherited-policy'),policyText='security:\n  fixture_policy: must-preserve\n';
  if(globalPolicy){fs.mkdirSync(policy);fs.writeFileSync(path.join(policy,'config.yaml'),policyText);fs.writeFileSync(path.join(f.home,'active_profile'),'sticky-other');fs.mkdirSync(path.join(f.home,'profiles','sticky-other'),{recursive:true});}
  const values={PATH:f.directory,PYTHONPATH:f.directory,HERMES_HOME:f.home,CODEX_HOME:path.join(f.directory,'empty-codex'),...(globalPolicy?{HERMES_MANAGED_DIR:policy}:{})},previous=new Map([...Object.keys(values),'HERMES_MANAGED_DIR'].map(key=>[key,process.env[key]]));
  for(const [key,value]of Object.entries(values))process.env[key]=value;if(!globalPolicy)delete process.env.HERMES_MANAGED_DIR;
  t.mock.method(os,'homedir',()=>f.directory);resetRuntimeDiscovery();t.after(()=>{for(const [key,value]of previous)if(value===undefined)delete process.env[key];else process.env[key]=value;resetRuntimeDiscovery();});
  const original=fs.readFileSync(path.join(f.home,'config.yaml'),'utf8'),result=await executeRuntime({runtime:'Hermes',prompt:f.prompt,cwd:f.directory,env:values,attachments:f.images.map(item=>({path:item.path,mimeType:'image/png'}))});
  assert.equal(result.status,'succeeded',result.error);assert.equal(result.result.hermesBootstrap.mode,'effective-mcp-gate-native-images');
  const receipt=JSON.parse(result.result.output);assert.deepEqual(receipt.user_message.slice(1).map(part=>sha(Buffer.from(part.image_url.url.split(',')[1],'base64'))),f.images.map(item=>item.sha256));
  assert.equal(receipt.profile,'default');assert.equal(receipt.sourceHome,f.home);
  if(globalPolicy){assert.notEqual(receipt.managed,policy);assert.match(receipt.managedConfig,/fixture_policy: must-preserve/);assert.equal(fs.readFileSync(path.join(policy,'config.yaml'),'utf8'),policyText);assert.equal(fs.readFileSync(path.join(f.home,'active_profile'),'utf8'),'sticky-other');assert.equal(fs.existsSync(path.join(f.home,'profiles','sticky-other','agent-invoked')),false);}
  assert.ok(receipt.managed);assert.equal(fs.existsSync(receipt.managed),false);assert.equal(fs.readFileSync(path.join(f.home,'config.yaml'),'utf8'),original);assert.equal(fs.readFileSync(path.join(f.home,'auth.json'),'utf8'),'synthetic-original-auth');
}
test('executeRuntime carries every image through managed native spawning and removes its temporary overlay', {skip:process.platform==='win32'},async t=>{
  await executeImageFixture(t);
});
test('ordinary Hermes multi-image execution inherits global policy in a private overlay and overrides sticky profile selection', {skip:process.platform==='win32'},async t=>{
  await executeImageFixture(t,{globalPolicy:true});
});
