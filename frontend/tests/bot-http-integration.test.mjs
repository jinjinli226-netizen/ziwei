import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createApp} from '../../backend/app.mjs';
import {createBotWorkbench} from '../src/bot-workbench.js';

test('real isolated Bot API integrates persisted configuration, main chat, controls, workspace and unknown Routine recovery',async()=>{
  const app=createApp({memory:true,requireAuth:true,enableScheduler:false,requireDeviceAuth:false});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,originalFetch=globalThis.fetch,oldWindow=globalThis.window;
  let cookie='',loseRunResponse=true;const calls=[];
  async function http(path,body,method=body?'POST':'GET'){
    const response=await originalFetch(base+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}: {})},...(body?{body:JSON.stringify(body)}:{})});
    const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
    const data=await response.json();assert.ok(response.ok,`${response.status}: ${data.error}`);return data;
  }
  try{
    const principal=await http('/api/auth/setup',{name:'E03 synthetic QA',email:'e03@fixture.invalid',password:'isolated-preview-test-password'});
    await http('/api/workspaces',{slug:'e03-a',name:'E03 A',kind:'personal'});await http('/api/workspaces',{slug:'e03-b',name:'E03 B',kind:'personal'});
    const fixtureDevice=app.locals.repo.createDevice('e03-a',{name:'E03 fixture',ownerUserId:principal.user.id});
    app.locals.repo.heartbeatDevice('e03-a',{deviceId:fixtureDevice.id,runtimes:{Hermes:{status:'available',version:'fixture-no-native',profiles:[{name:'default'}],models:[{id:'fixture-model'}]}}});
    let source=await readFile(new URL('../src/api.js',import.meta.url),'utf8');source=source.replace("'./api-base.js'",JSON.stringify(new URL('../src/api-base.js',import.meta.url).href)).replaceAll('import.meta.env.',`({VITE_API_URL:${JSON.stringify(base)},DEV:false}).`);
    globalThis.window={location:{origin:base,pathname:'/e03-a/bots'},dispatchEvent(){}};
    globalThis.fetch=async(url,options={})=>{
      calls.push({url,method:options.method||'GET',body:options.body});
      const response=await originalFetch(url,{...options,headers:{...options.headers,cookie}});
      if(loseRunResponse&&url.includes('/routines/')&&url.endsWith('/run')){loseRunResponse=false;await response.json();throw new TypeError('fixture lost response after server acceptance');}
      return response;
    };
    source+='\n//# sourceURL=bot-api-integration-fixture.js';
    const {api}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const bot=await api.createBot({name:'One employee, two views',targetDeviceId:fixtureDevice.id,runtimeProfile:'default',model:'fixture-model',idempotencyKey:'e03-create'},'e03-a');
    const employees=await http('/api/workspaces/e03-a/employees');assert.equal(employees.employees.filter(item=>item.id===bot.id).length,1);
    const ui=createBotWorkbench({api});await ui.setWorkspace('e03-a',bot.id);
    ui.state.draft.employee.persona='Saved configuration marker';assert.equal(await ui.save(),true);assert.equal(ui.state.bot.revision,2);assert.equal(ui.state.bot.employee.persona,'Saved configuration marker');
    const validation=await api.validateBot(bot.id,{expectedRevision:2,idempotencyKey:'e03-validation'},'e03-a');
    app.locals.repo.ackA2AAction(validation.action.id,{deviceId:fixtureDevice.id});
    app.locals.repo.resultA2AAction(validation.action.id,{status:'succeeded',result:{fixture:true,botValidation:{valid:true,schemaVersion:1,employeeId:bot.id,revision:2,sourceProfile:'default',nativeVersion:'fixture-no-native'}}});
    await ui.refresh();assert.equal(await ui.control('activate'),true);assert.equal(ui.state.bot.control_state,'active');
    const msg=await api.addConversationMessage(bot.main_conversation_id,{content:'Synthetic task only',clientMessageId:'e03-message'});
    app.locals.repo.ackA2AAction(msg.execution.id,{deviceId:fixtureDevice.id});app.locals.repo.authorizeBotStart(msg.execution.id,{deviceId:fixtureDevice.id});
    app.locals.repo.resultA2AAction(msg.execution.id,{status:'succeeded',result:{fixture:true,output:'Synthetic result, no native Hermes invocation'}});
    const chat=await api.conversation(bot.main_conversation_id);assert.ok(chat.messages.some(item=>item.content==='Synthetic result, no native Hermes invocation'));
    const routine=await api.createBotRoutine(bot.id,{name:'Synthetic daily',prompt:'fixture only',schedule:'每天 09:00',timezone:'Asia/Shanghai',idempotencyKey:'e03-routine'},'e03-a');
    assert.equal(routine.employee_id,bot.id);assert.equal(routine.conversation_id,bot.main_conversation_id);
    await ui.runRoutine(routine.id);assert.equal(ui.state.writeUnknown,true);await ui.refresh();assert.equal(ui.state.writeUnknown,true);
    assert.equal(await ui.recoverRoutine(),true);
    const runCalls=calls.filter(call=>call.url.endsWith('/run'));assert.equal(runCalls.length,2);assert.equal(runCalls[0].body,runCalls[1].body);
    assert.equal(app.locals.repo.listAutomationRuns(routine.id).length,1);
    await ui.control('pause');assert.equal(ui.state.bot.control_state,'paused');
    const other=await api.bots('e03-b');assert.equal(other.bots.length,0);
    await api.deleteBotRoutine(bot.id,routine.id,'e03-a');assert.equal((await api.botRoutines(bot.id,'e03-a')).routines.length,0);
    await http(`/api/workspaces/e03-a/employees/${bot.id}`,null,'DELETE');assert.equal((await api.bots('e03-a')).bots.length,0);
    assert.equal((await http('/api/workspaces/e03-a/employees')).employees.some(item=>item.id===bot.id),false);
    ui.dispose();
  }finally{globalThis.fetch=originalFetch;globalThis.window=oldWindow;server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));app.locals.repo.db.close();}
});
