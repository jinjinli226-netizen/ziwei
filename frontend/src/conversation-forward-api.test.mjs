import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createConversationForwarder} from './conversation-forward.mjs';

const source=(await readFile(new URL('./api.js',import.meta.url),'utf8'))
  .replace("'./api-base.js'",JSON.stringify(new URL('./api-base.js',import.meta.url).href))
  .replace("'./bounded-read.js'",JSON.stringify(new URL('./bounded-read.js',import.meta.url).href))
  .replaceAll('import.meta.env.','({VITE_API_URL:"",DEV:false}).');
async function fixture(t,fetch){
  const saved={fetch:globalThis.fetch,window:globalThis.window};
  globalThis.window={location:{origin:'https://forward.test',pathname:'/team/inbox'},dispatchEvent(){}};
  globalThis.fetch=fetch;t.after(()=>Object.assign(globalThis,saved));
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).api;
}
test('network-unknown forward is sent to the original source with identical request identity and credentials on manual retry',async t=>{
  const calls=[];const api=await fixture(t,async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body,options});
    if(calls.length===1)throw new TypeError('lost response');
    return {ok:true,status:200,json:async()=>({forward:{id:'forward',sourceConversationId:'source/id',targetConversationId:'target-conversation',targetEmployeeId:'target',mode:'reference'},duplicate:true})};
  });
  const editor=createConversationForwarder({send:api.forwardConversation,makeId:()=> 'fixed-request'});
  editor.setScope({workspace:'team',actor:'user',conversationId:'source/id'});editor.begin(['one','two']);editor.update({targetEmployeeId:'target'});
  await editor.submit(['target']);await editor.submit(['target']);
  assert.equal(calls.length,2);assert.equal(calls[0].url,'https://forward.test/api/conversations/source%2Fid/forwards');
  assert.deepEqual(calls[0].body,calls[1].body);assert.equal(calls[0].options.credentials,'include');assert.equal(calls[0].options.method,'POST');
});
test('read marker posts only its explicit visible message identity',async t=>{
  const calls=[];const api=await fixture(t,async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({conversationId:'source',lastReadMessageId:'visible-message',unreadCount:2})};});
  assert.equal((await api.markConversationRead('source','visible-message')).unreadCount,2);
  assert.equal(calls[0].url,'https://forward.test/api/conversations/source/read');
  assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),{messageId:'visible-message'});
});
test('forward API preserves explicit permission, busy and payload limit failures for editor decisions',async t=>{
  let status=403;const api=await fixture(t,async()=>({ok:false,status,json:async()=>({error:'No forward',code:status===409?'BOT_BUSY':'FORWARD_REJECTED'})}));
  for(status of [403,404,409,413])await assert.rejects(api.forwardConversation('source',{messageIds:['m']}),error=>error.status===status&&error.message==='No forward');
});
