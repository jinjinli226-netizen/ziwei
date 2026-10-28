import test from 'node:test';
import assert from 'node:assert/strict';
import {botPresence,botStopPresentation,botRecoveryEvent,botRecoveryDetail,processExitConfirmed} from './bot-presentation.js';

const proof={rootConfirmed:true,treeConfirmed:true,activeProcesses:0};
const run={id:'original',status:'expired',acked_at:'2026-10-14T00:00:00Z'};
const receipt={id:'receipt',type:'succeeded',data:{result:{validated:true,processExit:proof}}};

test('stop response requires the original execution exit proof before reporting stopped',()=>{
  const bot={control_state:'paused',latest_run:run};
  assert.match(botStopPresentation(bot).label,/未返回.*停止请求或退出确认/);
  assert.equal(botStopPresentation(bot).confirmed,false);
  const stop={id:'cancel',status:'succeeded',payload:{actionId:run.id},result:{stopConfirmed:true,processExit:proof}};
  assert.equal(botStopPresentation({...bot,stop_action:stop}).confirmed,false,'cancel acknowledgement cannot settle the original execution');
  assert.match(botStopPresentation({...bot,stop_action:{...stop,status:'pending'}}).label,/已下发.*尚未确认/);
  const stopped={...run,status:'failed',result:{stopConfirmed:true,processExit:proof}};
  assert.equal(botStopPresentation({...bot,latest_run:stopped}).confirmed,true);
  assert.equal(botStopPresentation({...bot,latest_run:{...stopped,result:{...stopped.result,code:'EXECUTION_UNCERTAIN'}}}).confirmed,false);
  assert.equal(botStopPresentation({...bot,latest_run:{...stopped,result:{stopConfirmed:true,processExit:{...proof,activeProcesses:1}}}}).confirmed,false);
  assert.equal(botStopPresentation({...bot,latest_run:{...stopped,status:'acked'}}).confirmed,false);
  assert.equal(botStopPresentation({...bot,latest_run:{...stopped,result:{result:{stopConfirmed:true,processExit:proof}}}}).confirmed,true);
  assert.equal(botStopPresentation({...bot,latest_run:{...stopped,result:{result:{stopConfirmed:true,executionState:'uncertain',processExit:proof}}}}).confirmed,false);
});

test('a cancelled dispatch is distinguished from a confirmed process stop',()=>{
  const state=botStopPresentation({latest_run:{id:'queued',status:'failed',result:{code:'BOT_CANCELLED_BEFORE_START',stopConfirmed:true}}});
  assert.equal(state.confirmed,false);assert.match(state.label,/尚未启动.*取消派发/);
});

test('recovery is offered only for an uncertain original action with a complete stored terminal event',()=>{
  assert.equal(botRecoveryEvent({...run,events:[receipt]}).id,'receipt');
  assert.equal(botRecoveryEvent({...run,status:'succeeded',events:[receipt]}),null);
  for(const event of [
    {...receipt,type:'progress'},
    {...receipt,data:{result:{processExit:{...proof,rootConfirmed:false}}}},
    {...receipt,data:{result:{processExit:{...proof,activeProcesses:1}}}},
    {...receipt,data:{result:{processExit:{treeConfirmed:true}}}},
    {...receipt,data:{result:{code:'EXECUTION_UNCERTAIN',processExit:proof}}},
    {...receipt,data:{result:{fixture:true,processExit:proof}}},
  ])assert.equal(botRecoveryEvent({...run,events:[event]}),null);
  assert.equal(processExitConfirmed({result:{processExit:proof}}),true);
  assert.match(botRecoveryDetail(run),/已失败.*原始回执已保留/);
  assert.match(botRecoveryDetail({...run,events:[receipt]}),/可恢复原回执/);
});

test('ordinary successful work and configuration validation keep their existing presentation',()=>{
  assert.equal(botPresence({control_state:'active',latest_run:{status:'succeeded',result:{processExit:proof}}}).label,'上次已完成');
  assert.equal(botPresence({control_state:'active',latest_run:{type:'hermes.bot.validate',status:'succeeded'}}).label,'已启用 · 待命');
  const ended=botStopPresentation({latest_run:{status:'succeeded',result:{processExit:proof}}});assert.equal(ended.confirmed,false);assert.equal(ended.ended,true);assert.match(ended.label,/已结束/);
});
