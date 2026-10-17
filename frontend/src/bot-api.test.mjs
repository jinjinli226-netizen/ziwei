import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('all Bot operations retain explicit workspace, escaped IDs and revision bodies', async () => {
  const source = (await readFile(new URL('./api.js', import.meta.url), 'utf8'))
    .replace("'./api-base.js'", JSON.stringify(new URL('./api-base.js', import.meta.url).href))
    .replace("'./bounded-read.js'", JSON.stringify(new URL('./bounded-read.js', import.meta.url).href))
    .replaceAll('import.meta.env.', '({VITE_API_URL:"",DEV:false}).');
  const saved = {window:globalThis.window,fetch:globalThis.fetch}, calls=[];
  globalThis.window = {location:{origin:'https://fixture.invalid',pathname:'/workspace-b/bots'}};
  globalThis.fetch = async (url, options) => {calls.push({url,options});return {ok:true,status:200,json:async()=>({})};};
  try {
    const {api} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    await api.bots('workspace-a');
    await api.bot('employee/a','workspace-a');
    await api.botCapabilities('device/a','workspace-a');
    await api.createBot({idempotencyKey:'create-1',name:'Fixture'},'workspace-a');
    await api.updateBot('employee/a',{expectedRevision:4,employee:{name:'Changed'}},'workspace-a');
    await api.validateBot('employee/a',{expectedRevision:5,idempotencyKey:'check-1'},'workspace-a');
    await api.controlBot('employee/a',{expectedRevision:5,expectedControlEpoch:2,operation:'stop'},'workspace-a');
    await api.botRuns('employee/a','workspace-a');
    await api.botRoutines('employee/a','workspace-a');
    await api.createBotRoutine('employee/a',{name:'Daily',timezone:'Asia/Shanghai'},'workspace-a');
    await api.updateBotRoutine('employee/a','routine/a',{status:'paused'},'workspace-a');
    await api.runBotRoutine('employee/a','routine/a',{idempotencyKey:'run-1'},'workspace-a');
    await api.deleteBotRoutine('employee/a','routine/a','workspace-a');
    await api.initializeEmployeeBot('employee/a',{idempotencyKey:'init-1'},'workspace-a');
    await api.botNativeAction('employee/a',{resource:'memory',operation:'read',expectedRevision:5,expectedControlEpoch:2,idempotencyKey:'native-1'},'workspace-a');
    await api.collaborateBot('employee/a',{mode:'message',targetEmployeeIds:['other'],content:'hello',expectedRevision:5,expectedControlEpoch:2,idempotencyKey:'collab-1'},'workspace-a');
    assert.equal(calls.length,16);
    assert.ok(calls.every(call=>call.url.startsWith('https://fixture.invalid/api/workspaces/workspace-a/')));
    assert.ok(calls[1].url.endsWith('/employee%2Fa'));
    assert.ok(calls[2].url.endsWith('/capabilities?deviceId=device%2Fa'));
    assert.equal(calls[4].options.method,'PATCH');
    assert.deepEqual(JSON.parse(calls[4].options.body),{expectedRevision:4,employee:{name:'Changed'}});
    assert.ok(calls[10].url.endsWith('/employee%2Fa/routines/routine%2Fa'));
    assert.equal(JSON.parse(calls[11].options.body).idempotencyKey,'run-1');
    assert.equal(calls[12].options.method,'DELETE');
    assert.ok(calls[13].url.endsWith('/employees/employee%2Fa/bot'));
    assert.equal(JSON.parse(calls[6].options.body).expectedControlEpoch,2);
    assert.ok(calls[14].url.endsWith('/bots/employee%2Fa/native/actions'));assert.equal(calls[14].options.method,'POST');
    assert.ok(calls[15].url.endsWith('/bots/employee%2Fa/collaboration'));assert.equal(JSON.parse(calls[15].options.body).targetEmployeeIds[0],'other');
    calls.length=0;
    await api.hermesProfiles('device/a','workspace-a');await api.createHermesProfile({profile:'independent',deviceId:'device/a',soul:'# independent\n'},'profile-original','workspace-a');await api.hermesProfileAction('action/a','workspace-a');
    assert.ok(calls.every(call=>call.url.startsWith('https://fixture.invalid/api/workspaces/workspace-a/hermes/profiles')));assert.ok(calls[0].url.endsWith('?deviceId=device%2Fa'));assert.equal(JSON.parse(calls[1].options.body).idempotencyKey,'profile-original');assert.ok(calls[2].url.endsWith('/requests/action%2Fa'));
    calls.length=0;await api.hermesProfiles('device-a');await api.createHermesProfile({profile:'old-call'});await api.hermesProfileAction('old-action');assert.ok(calls.every(call=>call.url.startsWith('https://fixture.invalid/api/workspaces/workspace-b/')));
    assert.equal(typeof api.provisionBot,'function');calls.length=0;await api.provisionBot('employee/a',{expectedRevision:7,expectedControlEpoch:3,idempotencyKey:'original-recovery'},'workspace-a');assert.equal(calls[0].url,'https://fixture.invalid/api/workspaces/workspace-a/bots/employee%2Fa/provision');assert.equal(calls[0].options.method,'POST');assert.equal(JSON.parse(calls[0].options.body).expectedControlEpoch,3);
    calls.length=0;await api.reconcileBotAction('employee/a','action/a',{eventId:'stored-event',expectedRevision:7,expectedControlEpoch:3},'workspace-a');assert.equal(calls[0].url,'https://fixture.invalid/api/workspaces/workspace-a/bots/employee%2Fa/actions/action%2Fa/reconcile');assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),{eventId:'stored-event',expectedRevision:7,expectedControlEpoch:3});
    calls.length=0;await api.botForceAbandonStatus('employee/a','workspace-a');await api.forceAbandonBot('employee/a',{expectedActionId:'action-original',expectedRevision:3,expectedControlEpoch:8,acknowledgeUncertain:true,idempotencyKey:'original-intent'},'workspace-a');
    assert.equal(calls[0].url,'https://fixture.invalid/api/workspaces/workspace-a/bots/employee%2Fa/force-abandon');assert.equal(calls[1].url,calls[0].url);assert.equal(calls[0].options.body,undefined);assert.equal(calls[1].options.method,'POST');assert.deepEqual(JSON.parse(calls[1].options.body),{expectedActionId:'action-original',expectedRevision:3,expectedControlEpoch:8,acknowledgeUncertain:true,idempotencyKey:'original-intent'});
    calls.length=0;await api.deleteEmployee('employee/a','workspace-a');await api.deleteEmployee('employee/a','workspace-a',{force:true,result:{stopConfirmed:true}});assert.ok(calls.every(call=>call.url==='https://fixture.invalid/api/workspaces/workspace-a/employees/employee%2Fa'&&call.options.method==='DELETE'));assert.equal(calls[0].options.body,undefined);assert.deepEqual(JSON.parse(calls[1].options.body),{force:true});
  } finally {Object.assign(globalThis,saved);}
});
