import test from 'node:test';
import assert from 'node:assert/strict';

const {conversationStreamMessages}=await import('./conversation-stream.js').catch(error=>{
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
 return {conversationStreamMessages:()=>[]};
});
const user={id:'user',role:'user',content:'请汇总'};
const execution=(text,extra={})=>({id:'action-1',status:'acked',stream:{channel:'assistant',messageId:'stream:action-1',sequence:2,text},...extra});

test('real assistant snapshots grow one message without mutating saved history or appending replayed text',()=>{
 const messages=[user],first=conversationStreamMessages(messages,execution('已核对'));
 assert.equal(first.length,2);assert.equal(first[1].content,'已核对');assert.equal(first[1].streaming,true);
 const second=conversationStreamMessages(messages,execution('已核对全部数据'));
 assert.equal(second[1].id,first[1].id);assert.equal(second[1].content,'已核对全部数据');
 assert.deepEqual(conversationStreamMessages(messages,execution('已核对全部数据')),second);
 assert.deepEqual(messages,[user]);
});

test('the formal terminal reply replaces the transient answer and preserves authoritative attachments',()=>{
 const final={id:'final',role:'assistant',content:'最终核对后的正文',attachments:[{name:'结果.csv'}]};
 assert.deepEqual(conversationStreamMessages([user,final],execution('尚未核对完',{status:'succeeded'})),[user,final]);
 for(const status of ['failed','cancelled','expired'])assert.deepEqual(conversationStreamMessages([user,final],execution('未完成片段',{status})),[user,final]);
});

test('tool output, public reasoning and missing body never become invented assistant text',()=>{
 for(const stream of [undefined,{channel:'reasoning',text:'公开摘要'},{channel:'tool',text:'命令输出'},{channel:'assistant',text:''}]){
  assert.deepEqual(conversationStreamMessages([user],execution('',{stream})),[user]);
 }
 assert.deepEqual(conversationStreamMessages([user],null),[user]);
});

test('a persisted reply with the stream identity wins even before its terminal receipt arrives',()=>{
 const final={id:'stream:action-1',role:'assistant',content:'正式正文'};
 assert.deepEqual(conversationStreamMessages([user,final],execution('旧片段')),[user,final]);
});

test('the dedicated response schema keeps its runtime identity without requiring an extra channel field',()=>{
 const stream={schemaVersion:1,responseId:'action-1:assistant',sequence:3,phase:'streaming',text:'来自真实运行时的公开正文',format:'markdown'};
 const projected=conversationStreamMessages([user],execution('',{stream}));
 assert.equal(projected.length,2);assert.equal(projected[1].id,stream.responseId);assert.equal(projected[1].content,stream.text);
});
