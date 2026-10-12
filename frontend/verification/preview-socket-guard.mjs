import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {previewSocketGuard} from '../preview/native-runtime.mjs';
const root=path.resolve(import.meta.dirname,'../..'),folder=path.join(root,'.local/e03-preview-socket-guard');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'sitecustomize.py'),previewSocketGuard(4283));
const launcher='C:/Users/25941/AppData/Local/hermes/bin/hermes.exe',interpreter=fs.readFileSync(launcher).toString('latin1').match(/#!([^\r\n]+)/)?.[1]?.trim();assert.ok(interpreter&&fs.existsSync(interpreter),'Use the actual installed launcher interpreter');
const other=net.createServer();await new Promise((resolve,reject)=>{other.once('error',reject);other.listen(0,'127.0.0.1',resolve);});
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','PATHEXT'].includes(key))),HOME:folder,USERPROFILE:folder,PYTHONNOUSERSITE:'1',PYTHONPATH:folder};
try{const proof=execFileSync(interpreter,['-c',`import socket,asyncio,json\na,b=socket.socketpair();a.send(b'x');assert b.recv(1)==b'x';a.close();b.close()\nasyncio.run(asyncio.sleep(0.001))\ns=socket.socket()\ntry:\n s.connect(('127.0.0.1',${other.address().port}))\n raise AssertionError('Other project endpoint was permitted')\nexcept RuntimeError: pass\nfinally: s.close()\nprint(json.dumps({'socketpair':True,'asyncio':True,'otherProjectDenied':True}))`],{env,encoding:'utf8',windowsHide:true});assert.equal(JSON.parse(proof).otherProjectDenied,true);console.log(proof.trim());}finally{other.closeAllConnections?.();await new Promise(resolve=>other.close(resolve));}
