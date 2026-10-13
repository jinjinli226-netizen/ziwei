// Isolated installed-adapter acceptance; no cloud credentials or real messages.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {spawnSupervisedRuntime} from '../src/runtime-process.mjs';

const installed=path.resolve(process.env.LOCALAPPDATA,'hermes/hermes-agent');
const python=path.join(installed,'venv/Scripts/python.exe');
const root=path.resolve('.local',`receive-health-${Date.now()}`),guard=path.join(root,'guard'),home=path.join(root,'home');
for(const directory of [guard,home])fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(guard,'sitecustomize.py'),`import socket,ipaddress
_connect=socket.socket.connect
_resolve=socket.getaddrinfo
def allowed(host):
 if host in ('localhost',None): return True
 try: return ipaddress.ip_address(host).is_loopback
 except ValueError: return False
def connect(self,address):
 if isinstance(address,tuple) and not allowed(address[0]): raise RuntimeError('external network forbidden')
 return _connect(self,address)
def resolve(host,*args,**kwargs):
 if not allowed(host): raise RuntimeError('external DNS forbidden')
 return _resolve(host,*args,**kwargs)
socket.socket.connect=connect
socket.getaddrinfo=resolve
`);
const env={...process.env,HERMES_HOME:home,PYTHONPATH:guard,PYTHONDONTWRITEBYTECODE:'1',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'};
const tracked=['gateway/platforms/base.py','gateway/platforms/webhook.py',...['slack','telegram','discord','feishu','dingtalk','mattermost'].map(name=>`plugins/platforms/${name}/adapter.py`)];
function snapshot(){return Object.fromEntries(tracked.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(installed,file))).digest('hex')]));}
const before=snapshot(),statusBefore=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:installed,encoding:'utf8',windowsHide:true});
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:installed,encoding:'utf8',windowsHide:true}).trim();
const runs=[];
async function run(label,args){
  const log=path.join(root,label+'.log'),native=spawnSupervisedRuntime({command:python,args,cwd:root,env});
  native.child.on('error',()=>{});
  for(const stream of [native.child.stdout,native.child.stderr])stream.on('data',data=>fs.appendFileSync(log,data));
  native.child.stdin.end();
  const timer=setTimeout(()=>void native.stop(),90000);
  const processExit=await native.completionEvidence;clearTimeout(timer);
  const entry={label,log:path.relative(process.cwd(),log).replaceAll('\\','/'),processExit};runs.push(entry);
  fs.writeFileSync(path.join(root,'progress.json'),JSON.stringify(runs,null,2));
  assert.equal(processExit.rootExitCode,0,fs.readFileSync(log,'utf8'));
  assert.equal(processExit.treeConfirmed,true);assert.equal(processExit.activeProcesses,0);
  return {entry,output:fs.readFileSync(log,'utf8')};
}
for(const [label,file,count] of [['receive-health','hermes-receive-health.py',16],['prior-native-regression','hermes-native-followup.py',9]]){
  const {entry,output}=await run(label,[path.resolve('test/fixtures',file)]);
  entry.tests=Number(output.match(/Ran (\d+) tests/)?.[1]);assert.equal(entry.tests,count);assert.match(output,/\nOK\s*$/);
}
const {output:manifest}=await run('native-manifest',['-c',"import importlib.util,json,hermes_cli;print(json.dumps({'version':hermes_cli.__version__,'sdkAvailable':{n:importlib.util.find_spec(n) is not None for n in ['slack_sdk','slack_bolt','telegram','discord','dingtalk_stream','lark_oapi','aiohttp']}}))"]);
assert.deepEqual(snapshot(),before);
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:installed,encoding:'utf8',windowsHide:true}),statusBefore);
const receipt={date:new Date().toISOString(),...JSON.parse(manifest.trim()),installedHead:head,installedSourceHashes:before,installedTrackedStatusUnchanged:true,runs,network:'loopback sockets only; external connect and DNS blocked',boundary:'Actual installed adapters. Slack, Telegram, Discord and DingTalk SDK boundaries are controlled fixtures; Feishu uses installed SDK and a local WebSocket. No cloud account validation.'};
fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2));
console.log('RECEIPT '+path.join(root,'receipt.json'));
