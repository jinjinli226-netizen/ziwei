import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {CredentialStore} from '../src/config.mjs';
const moduleUrl=new URL('../src/config.mjs',import.meta.url).href;
const select=account=>({origin:'https://race.example.test',profile:'work',account,purpose:'person'});
const credential=value=>({mode:'native',workspace:'team',session:value,identitySource:'legacy-native'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForFile(file){const deadline=Date.now()+5000;while(Date.now()<deadline){try{await fs.access(file);return;}catch{}await sleep(10);}assert.fail('isolated worker did not reach the intended read barrier');}
function pausedSave(root,account){
  const ready=path.join(root,'worker-read-ready'),release=path.join(root,'worker-release');
  const code=`import fs from 'node:fs/promises';import {CredentialStore} from ${JSON.stringify(moduleUrl)};const store=new CredentialStore(${JSON.stringify(root)});const originalRead=store.read.bind(store);let first=true;store.read=async()=>{const value=await originalRead();if(first){first=false;await fs.writeFile(${JSON.stringify(ready)},'ready');while(true){try{await fs.access(${JSON.stringify(release)});break;}catch{}await new Promise(resolve=>setTimeout(resolve,5));}}return value;};await store.save(${JSON.stringify(select(account))},${JSON.stringify(credential('isolated-worker-secret'))});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot||'',ZIWEI_WORKSPACE_CONFIG_DIR:root},windowsHide:true});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Isolated credential worker exited ${code}: ${stderr}`)));});
  return{ready,release,finished};
}
for(const action of ['save','clear'])test(`cross-process ${action} serializes the full credential read-modify-write transaction`,async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-store-race-'));let worker;
  try{
    const store=new CredentialStore(root);await store.save(select('retained'),credential('seed-private'));
    worker=pausedSave(root,'worker');await waitForFile(worker.ready);
    const mutation=action==='save'?store.save(select('other'),credential('other-private')):store.clear(select('retained'));
    // Without a lock this finishes against the stale snapshot. With a lock it
    // waits until the child completes its transaction. Neither schedule deadlocks.
    await Promise.race([mutation,sleep(100)]);await fs.writeFile(worker.release,'release');await Promise.all([worker.finished,mutation]);
    assert.ok(await store.load(select('worker')),'the worker slot must remain');
    if(action==='save'){assert.ok(await store.load(select('other')),'a concurrent different-slot save must not be lost');assert.ok(await store.load(select('retained')));}
    else assert.equal(await store.load(select('retained')),null,'a cleared credential must never be resurrected by a stale different-slot save');
  }finally{if(worker){await fs.writeFile(worker.release,'release').catch(()=>{});await worker.finished.catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
});
