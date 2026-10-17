import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';

function fixture(t) {
  const repo=createRepository({memory:true}),management=createManagementService(repo);
  t.after(()=>repo.db.close());
  repo.heartbeatDevice('test-111',{deviceId:'runs-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}]}}});
  const bot=management.bots.create('test-111',{name:'Run query fixture',targetDeviceId:'runs-pc',runtimeProfile:'default',idempotencyKey:'runs-query-bot'});
  const ws=repo.getWorkspace('test-111');
  const insert=repo.db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,result_json) VALUES(?,?,?,?,?,?,?,?,?)');
  const add=(id,payload,{workspaceId=ws.id,createdAt='2027-01-01T00:00:00.000Z',raw=false,result={summary:'retained result',unknown:{keep:true}}}={})=>{
    insert.run(id,workspaceId,'ziwei_user','conversation.execute',raw?payload:JSON.stringify(payload),id,'succeeded',createdAt,JSON.stringify(result));
    return id;
  };
  return {repo,bots:management.bots,bot,ws,add};
}

function originalRunIds(db,workspaceId,employeeId) {
  const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
  return db.prepare('SELECT id,payload_json FROM a2a_actions WHERE workspace_id=? ORDER BY created_at DESC,rowid DESC').all(workspaceId)
    .filter(row=>parse(row.payload_json)?.hermesBot?.employeeId===employeeId).slice(0,100).map(row=>row.id);
}

test('runs filters before limiting and preserves descending timestamp/rowid order and full receipts',t=>{
  const {repo,bots,bot,ws,add}=fixture(t),expectedNewest=[];
  for(let index=0;index<125;index++) {
    const id=add(`own-${index}`,{hermesBot:{employeeId:bot.id},unknown:{keep:index}}, {createdAt:index<20?'2026-01-01T00:00:00.000Z':'2027-01-01T00:00:00.000Z'});
    if(index>=20)expectedNewest.unshift(id);
    // Newer unrelated actions must not consume this employee's 100 result slots.
    add(`unrelated-${index}`,{hermesBot:{employeeId:'different-employee'},extra:'x'.repeat(2048)},{createdAt:'2028-01-01T00:00:00.000Z'});
  }
  const schema=repo.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
  const runs=bots.runs('test-111',bot.id),ids=runs.map(row=>row.id);
  assert.equal(runs.length,100);
  assert.deepEqual(ids,expectedNewest.slice(0,100));
  assert.deepEqual(ids,originalRunIds(repo.db,ws.id,bot.id));
  assert.equal(runs[0].payload.unknown.keep,124);
  assert.deepEqual(runs[0].result,{summary:'retained result',unknown:{keep:true}});
  assert.deepEqual(repo.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(),schema);
});

test('runs tolerates invalid JSON and excludes null, missing, scalar and foreign employee identities',t=>{
  const {repo,bots,bot,ws,add}=fixture(t);
  const invalid=['{not-json','', 'null','false','7','"text"','[]','{}','{"hermesBot":null}','{"hermesBot":{"employeeId":null}}','{"hermesBot":{"employeeId":7}}'];
  invalid.forEach((payload,index)=>add(`invalid-${index}`,payload,{raw:true,createdAt:'2028-01-01T00:00:00.000Z'}));
  const match=add('valid-same-employee',{hermesBot:{employeeId:bot.id}});
  add('top-level-only',{employeeId:bot.id});
  add('other-bot',{hermesBot:{employeeId:bot.id+'-other'}});
  const runs=bots.runs('test-111',bot.id);
  assert.deepEqual(runs.map(row=>row.id),originalRunIds(repo.db,ws.id,bot.id));
  assert.equal(runs[0].id,match);
  assert(!runs.some(row=>row.id.startsWith('invalid-')||['top-level-only','other-bot'].includes(row.id)));
});

test('runs keeps workspace, membership, visibility and authorized device scope checks',t=>{
  const {repo,bots,bot,ws,add}=fixture(t),db=repo.db;
  add('visible-own-run',{hermesBot:{employeeId:bot.id}});
  db.prepare('INSERT INTO workspaces(id,slug,name,created_at) VALUES(?,?,?,?)').run('foreign-runs-ws','foreign-runs','Other workspace','2026-01-01T00:00:00.000Z');
  add('foreign-workspace-run',{hermesBot:{employeeId:bot.id}},{workspaceId:'foreign-runs-ws',createdAt:'2029-01-01T00:00:00.000Z'});
  for(const [user,role] of [['runs-owner','owner'],['runs-member','member']])db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run(`member-${user}`,ws.id,user,user,`${user}@example.test`,role,'2026-01-01T00:00:00.000Z');
  db.prepare("UPDATE employees SET visibility='personal',owner_user_id=? WHERE id=?").run('runs-owner',bot.id);
  assert(bots.runs('test-111',bot.id,{actorUserId:'runs-owner'}).some(row=>row.id==='visible-own-run'));
  assert(!bots.runs('test-111',bot.id,{actorUserId:'runs-owner'}).some(row=>row.id==='foreign-workspace-run'));
  assert.throws(()=>bots.runs('missing-workspace',bot.id),{code:'WORKSPACE_NOT_FOUND',status:404});
  assert.throws(()=>bots.runs('foreign-runs',bot.id),{code:'EMPLOYEE_NOT_FOUND',status:404});
  assert.throws(()=>bots.runs('test-111',bot.id,{actorUserId:'unrelated-user',actorRole:'owner'}),{code:'WORKSPACE_FORBIDDEN',status:403});
  assert.throws(()=>bots.runs('test-111',bot.id,{actorUserId:'runs-member',actorRole:'owner'}),{code:'EMPLOYEE_NOT_FOUND',status:404});
  assert.throws(()=>bots.runs('test-111',bot.id,{deviceCredentialDeviceId:'runs-pc'}),{code:'BOT_DEVICE_SCOPE_REQUIRED',status:403});
  assert.throws(()=>bots.runs('test-111',bot.id,{deviceCredentialDeviceId:'another-pc',deviceScope:'another-pc'}),{code:'BOT_NOT_FOUND',status:404});
  const deviceRuns=bots.runs('test-111',bot.id,{deviceCredentialDeviceId:'runs-pc',deviceScope:'runs-pc'});
  assert(deviceRuns.some(row=>row.id==='visible-own-run'));
  assert(!deviceRuns.some(row=>row.id==='foreign-workspace-run'));
});

test('the explicit mobile limit hydrates only the newest five while the default still returns one hundred complete actions',t=>{
  const {repo,bots,bot,ws,add}=fixture(t);
  for(let index=0;index<110;index++)add(`limited-${index}`,{hermesBot:{employeeId:bot.id},retained:{context:'x'.repeat(128)}});
  const original=repo.getA2AAction,hydrated=[];
  repo.getA2AAction=function(id,options){hydrated.push(id);return original.call(this,id,options);};
  const mobile=bots.runs('test-111',bot.id,{}, {limit:5});
  assert.equal(hydrated.length,5);assert.equal(mobile.length,5);
  assert.deepEqual(mobile.map(row=>row.id),originalRunIds(repo.db,ws.id,bot.id).slice(0,5));
  repo.getA2AAction=original;
  const defaultRuns=bots.runs('test-111',bot.id);
  assert.equal(defaultRuns.length,100);assert.deepEqual(mobile,defaultRuns.slice(0,5));
  assert.equal(bots.runs('test-111',bot.id,{}, {limit:'5'}).length,100);
});
