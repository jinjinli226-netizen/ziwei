import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeInvocation,runtimeTerminalEnvironment} from '../src/runtime-adapters.mjs';

test('Windows Hermes piped JSON normalizes TERM without mutating caller, proxy or PATH',()=>{
  const original=Object.freeze({TERM:'xterm-256color',term:'xterm',Term:'vt100',PATH:'C:\\Windows;C:\\Program Files\\nodejs',HTTPS_PROXY:'http://127.0.0.1:10808',ALL_PROXY:'socks5://127.0.0.1:10808',HERMES_HOME:'C:\\hermes\\profiles\\employee',HERMES_MANAGED_DIR:'C:\\private\\overlay'});
  const result=runtimeTerminalEnvironment({runtime:'Hermes',invocation:runtimeInvocation('Hermes',{prompt:'query'}),env:original,platform:'win32'});
  assert.equal(result.TERM,'dumb');assert.deepEqual(Object.keys(result).filter(k=>/^term$/i.test(k)),['TERM']);
  assert.deepEqual(Object.fromEntries(Object.entries(result).filter(([k])=>k!=='TERM')),Object.fromEntries(Object.entries(original).filter(([k])=>!/^term$/i.test(k))));
  assert.equal(original.TERM,'xterm-256color');assert.equal(original.term,'xterm');
});

for(const [name,runtime,platform] of [
  ['macOS Hermes','Hermes','darwin'],
  ['Linux Hermes','Hermes','linux'],
  ['Windows Codex','Codex','win32'],
  ['Windows Claude','Claude','win32'],
  ['Windows Gemini','Gemini','win32'],
])test(`${name} keeps its terminal environment`,()=>{
  const env=Object.freeze({TERM:'xterm-256color',SHELL:'bash',HTTPS_PROXY:'http://127.0.0.1:10808'});
  assert.equal(runtimeTerminalEnvironment({runtime,invocation:runtimeInvocation(runtime,{prompt:'query'}),env,platform}),env);
});

test('Hermes plain, single-image text, multi-image and Bot query routes share the piped terminal policy',()=>{
  const image=path=>({path,mimeType:'image/png'}),routes=[runtimeInvocation('Hermes',{prompt:'query'}),runtimeInvocation('Hermes',{prompt:'query',attachments:[image('/fixture/one.png')]}),runtimeInvocation('Hermes',{prompt:'query',attachments:[image('/fixture/one.png'),image('/fixture/two.png')]}),{args:['chat','--query-file','-','-c','Ziwei conversation','--format','stream-json']},{args:['chat','--query','query','--format','json']}];
  assert.equal(routes[1].format,'text');
  for(const invocation of routes)assert.equal(runtimeTerminalEnvironment({runtime:'Hermes',invocation,env:{TERM:'xterm-256color'},platform:'win32'}).TERM,'dumb');
  const interactive=Object.freeze({TERM:'xterm-256color'});assert.equal(runtimeTerminalEnvironment({runtime:'Hermes',invocation:{args:['chat','--format','stream-json']},env:interactive,platform:'win32'}),interactive);
});
