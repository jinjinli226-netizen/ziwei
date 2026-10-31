import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createActionDelivery,ARCHIVED_UNCONFIRMED_STATE} from '../src/daemon-action-delivery.mjs';
import {archiveBlockedDeliveriesForUpdate} from '../src/client-delivery-update-migration.mjs';

const action={id:'action_legacy_blocked',type:'employee.dsh.operation',workspace_id:'demo',agent_id:'ziwei_user',dedupe_key:'legacy-blocked',payload:{deviceId:'pc-1',employeeId:'employee-1'}};

function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-update-migration-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const env={ZIWEI_USER_HOME:home};
 const config={connectionState:'connected',apiBase:'http://127.0.0.1:46197',workspace:'demo',deviceId:'pc-1',deviceToken:'token'};
 fs.writeFileSync(path.join(home,'ziwei_user.json'),JSON.stringify(config));
 const directory=path.join(home,'runtime','action-delivery');
 const delivery=createActionDelivery({directory,identity:config,post:async()=>{throw Object.assign(new Error('rejected'),{status:400});},dispatch:async()=>{throw new Error('dispatch must not run');},onConfirmed:async()=>{}});
 return {home,env,config,directory,delivery};
}

test('updater migration automatically archives a permanent blocked delivery and preserves evidence',async t=>{
 const f=fixture(t);
 await assert.rejects(deliveryExecute(f.delivery),/rejected/);
 const before=fs.readdirSync(f.directory).filter(name=>name.endsWith('.json')).sort();
 const result=archiveBlockedDeliveriesForUpdate({root:f.home,env:f.env});
 assert.deepEqual(result,{archived:1,remaining:0,connections:1,errors:[]});
 const journal=JSON.parse(fs.readFileSync(path.join(f.directory,before.find(name=>/^\w{64}\.json$/.test(name))),'utf8'));
 assert.equal(journal.state,ARCHIVED_UNCONFIRMED_STATE);
 assert.equal(journal.retainEvidence,true);
 assert.equal(journal.archive.serverTerminal,false);
 assert.equal(Object.hasOwn(journal,'serverStatus'),false);
 assert.equal(before.filter(name=>name.endsWith('.action.json')).length,1);
 assert.equal(before.filter(name=>name.endsWith('.result.json')).length,0);
});

test('updater migration leaves transient or corrupt records untouched',t=>{
 const f=fixture(t);
 const result=archiveBlockedDeliveriesForUpdate({root:f.home,env:f.env});
 assert.equal(result.archived,0);
 assert.equal(result.remaining,0);
});

async function deliveryExecute(delivery){return delivery.execute(action);}
