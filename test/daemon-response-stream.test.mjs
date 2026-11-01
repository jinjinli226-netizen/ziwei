import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ActionDispatcher} from '../src/daemon.mjs';

test('structured public response snapshots arrive before execution completes while raw stdout stays metadata',async()=>{
  const events=[];let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const dispatcher=new ActionDispatcher({execute:async(_action,context)=>{
    context.onOutput('private raw stdout');
    context.onStage({stage:'response',text:'你好'});
    context.onStage({stage:'tool',message:'读取资料'});
    context.onStage({stage:'response',text:'你好，已经找到资料。'});
    await pending;return {output:'你好，已经找到资料。'};
  },onEvent:(type,data)=>events.push({type,data})});
  const running=dispatcher.dispatch({id:'public-stream',type:'agent.execute',payload:{employeeId:'employee',prompt:'回答'}});
  try{
    for(let i=0;i<20&&!events.some(row=>row.type==='action.response');i++)await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(events.filter(row=>row.type==='action.response').map(row=>row.data.text),['你好','你好，已经找到资料。']);
    assert.equal(events.some(row=>row.type==='action.succeeded'),false);
    assert.equal(events.some(row=>row.type==='action.stage'&&row.data.stage==='response'),false);
    assert.equal(events.find(row=>row.type==='action.output').data.text,undefined);
    assert.equal(events.some(row=>row.type==='action.stage'&&row.data.stage==='tool'),true);
  }finally{finish();}
  assert.equal((await running).status,'succeeded');
});

test('daemon response logs contain only execution identity and text size',()=>{
  const source=fs.readFileSync(new URL('../daemon/ziwei_user.mjs',import.meta.url),'utf8');
  const log=source.slice(source.indexOf('function log('),source.indexOf('\nfunction rotate('));
  const lines=[];
  const context=vm.createContext({Buffer,Date,JSON,redactSecrets:value=>value,fs:{appendFileSync:(_path,line)=>lines.push(line)},logPath:'fixture',process:{pid:1},VERSION:'fixture',console:{log(){}},extra:undefined});
  vm.runInContext(`${log};log('action.response',{workspace:'test',actionId:'public-stream',type:'agent.execute',text:'private answer body'});`,context);
  const row=JSON.parse(lines[0]);assert.equal(row.actionId,'public-stream');assert.equal(row.bytes,Buffer.byteLength('private answer body'));
  assert.doesNotMatch(lines[0],/private answer body/);assert.equal(row.text,undefined);
});
