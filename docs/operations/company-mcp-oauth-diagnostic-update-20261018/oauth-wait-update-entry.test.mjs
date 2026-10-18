// Local source/archive checks only. No COM, Windows process, HTTP or listener.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),read=name=>fs.readFileSync(path.join(here,name),'utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('frozen entry embeds exact helpers and pins the verified diagnostic target before Windows/task/file operations',()=>{
 const text=read('register-company-oauth-wait-update.ps1'),worker=read('tk-self-update-owned-idle.ps1');
 assert(text.indexOf("'TARGET_NOT_FROZEN'")<text.indexOf("$Stage='prior_read_only'"));
 assert(text.indexOf("'TARGET_NOT_FROZEN'")<text.indexOf("$Stage='writing_new_owned_job'"));
 for(const [variable,name]of [['Worker','tk-self-update-owned-idle.ps1'],['Stop','owned-idle-stop.mjs'],['Handle','owned-idle-handle.ps1']]){
  const match=text.match(new RegExp("\\$"+variable+"Bytes=\\[Convert\\]::FromBase64String\\('([^']+)'\\);\\$"+variable+"Sha='([a-f0-9]{64})'"));
  assert(match);const bytes=Buffer.from(match[1],'base64');assert(bytes.equals(fs.readFileSync(path.join(here,name))));assert.equal(sha(bytes),match[2]);
 }
 const pins=JSON.parse(read('artifacts.json')).target;
 assert(!text.includes('__TARGET_'));assert(!worker.includes('__TARGET_'));
 for(const key of ['TARGET_BUILD','TARGET_COMMIT','TARGET_ARCHIVE_SHA','TARGET_BOOTSTRAP_SHA']){assert(worker.includes("'"+pins[key]+"'"));assert(text.includes("'"+pins[key]+"'"));}
 assert(worker.includes("$ExpectedBootstrapBytes = '"+pins.TARGET_BOOTSTRAP_BYTES+"'"));
 assert(read('tk-self-update-owned-idle.ps1.in').includes('__TARGET_BUILD__'));
 assert(worker.indexOf("'TARGET_NOT_FROZEN'")<worker.indexOf("$Stage = 'worker_preflight'"));
});
test('fresh task is CREATE only, current-user Limited, single trigger and no updater retry or old-task mutation',()=>{
 const entry=read('register-company-oauth-wait-update.ps1.in'),worker=read('tk-self-update-owned-idle.ps1');
 assert.equal((entry.match(/RegisterTaskDefinition\(/g)||[]).length,1);
 assert(entry.includes('RegisterTaskDefinition($TaskName,$d,2,$Sid,$null,3,$null)'));
 assert(entry.includes('$d.Principal.RunLevel=0'));assert(entry.includes('$d.Principal.LogonType=3'));
 assert(entry.includes('$d.Settings.RestartCount=0'));assert(entry.includes('$d.Settings.MultipleInstances=2'));
 assert.equal((entry.match(/Triggers\.Create\(1\)/g)||[]).length,1);assert(!entry.includes('.Run('));assert(!entry.includes('DeleteTask('));
 assert(entry.includes("$PriorSha='7fd4dc4ed078c92909215022b262899604f5f751c94be3eb192173e37f3c8e0f'"));
 assert(entry.includes('$Folder.GetTasks(1)|Where-Object {$_.Name -ceq $name}'));
 assert(entry.includes("$PriorTask='Ziwei.TK.Scope.Update.20261018'"));
 assert(entry.includes("maintenance\\tk-scope-update-20261018"));
 assert(entry.includes("maintenance\\tk-oauth-wait-update-20261018"));
 assert(entry.includes("$Prior.sourceBuild -ceq '88b2ea9f41c10c53498ecb524ad1dc5d836813440f804a61050f0e98da9cc14e'"));
 assert(!entry.includes('maintenance\\tk-update-fbb52e2'));
 assert(!entry.includes("$PriorTask='Ziwei.TK.OAuthWait.Update.20261018'"));

 assert(entry.indexOf("$Stage='prior_read_only'")<entry.indexOf("$Stage='writing_new_owned_job'"));
 assert(worker.includes('[IO.FileMode]::CreateNew'));assert(worker.includes('$attemptStream.Flush($true)'));
 assert.equal((worker.match(/ExactRunner \$bootstrap \$ExpectedBootstrap/g)||[]).length,1);
 assert(!/\b(?:Stop-Process|taskkill)\b/i.test(entry+worker));assert(!worker.includes(' -Force'));
});
test('native stop and restore paths bind current 5a source and preserve opaque historical bytes',()=>{
 const js=read('owned-idle-stop.mjs'),ps=read('owned-idle-handle.ps1'),worker=read('tk-self-update-owned-idle.ps1');
 const source='5a642107fa32d8e8f09ea139a9f964e7f50c77d9648788ae5aba6e96ac509fec';
 assert(js.includes("OLD_BUILD='"+source+"'"));assert(ps.includes("$d.build -ceq '"+source+"'"));
 for(const text of [js,ps,worker])assert(!text.includes('161cc99010d6cdee4e3d8834135ac2ed4e8fb2031b746755b7d53de0b76dfb0b'));
 assert(js.includes("plan.task==='Ziwei.TK.OAuthWait.Update.20261018'&&plan.sourceBuild===OLD_BUILD"));
 assert(js.includes("need(plan.configSha256===configHash,'IDENTITY_CHANGED')"));
 assert(js.includes(sha(Buffer.from(ps))));assert(worker.includes(sha(Buffer.from(js))));assert(worker.includes(sha(Buffer.from(ps))));
 assert(!/unlinkSync|rmSync|DeleteFile|Remove-Item/.test(js+ps+worker));
 assert.equal((ps.match(/\.Kill\(\)/g)||[]).length,1);assert(!ps.includes('treeConfirmed'));
});
