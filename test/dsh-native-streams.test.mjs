import test from 'node:test';
import assert from 'node:assert/strict';
import {dshFixture} from './fixtures/dsh-protocol.mjs';
const streams=await import('../src/dsh-native-streams.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
test('native history reads the first session snapshot and closes its own subscription',async t=>{
 assert.equal(typeof streams.readDshNativeSnapshot,'function');const f=await dshFixture(t,{initialRecords:[{type:'event',event:{type:'assistant/message',seq:1,data:{content:[{type:'text',text:'retained'}]}}}]});
 const snapshot=await streams.readDshNativeSnapshot({baseUrl:f.baseUrl,botName:'alpha',args:{request:{address:{kind:'session',sessionId:'owned-session'},maxMessages:100}},WebSocketImpl:f.transport.WebSocketImpl});
 assert.equal(snapshot.type,'snapshot');assert.equal(snapshot.records.length,1);assert.equal(f.connections[0].readyState,3);
});
test('native event subscriptions are ready before a caller submits work and can be detached',async t=>{
 assert.equal(typeof streams.subscribeDshNativeEvents,'function');const f=await dshFixture(t),events=[];
 const detach=await streams.subscribeDshNativeEvents({baseUrl:f.baseUrl,botName:'alpha',WebSocketImpl:f.transport.WebSocketImpl,onEvent:event=>events.push(event)});
 const ws=f.connections[0];ws.deliver({type:'item',streamId:ws.eventsId,value:{type:'emit',event:'plugin-manager/install-log',args:[{requestId:'native-attempt',text:'line'}]}});
 assert.equal(events.at(-1).event,'plugin-manager/install-log');detach();assert.equal(ws.readyState,3);
});
