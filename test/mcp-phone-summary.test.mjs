import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpClient, createMcpHandler} from '../scripts/ziwei-mcp.mjs';

const TOKEN='phone-summary-fixture-token';
const directory=(overrides={})=>({workspace:'summary-qa',skill:{id:'skill-qa',installed:true},computers:[{id:'pc-qa'}],phones:[{id:'phone-qa',alias:'验收手机',status:'online'}],employees:[{id:'employee-qa'}],api:{status:'healthy',error:null},...overrides});
function setup(payload,{status=200}={}) {
  const requests=[];
  const client=createMcpClient({workspace:'summary-qa',baseUrl:'https://fixture.test',token:TOKEN,fetchImpl:async(url,init)=>{
    requests.push({url:String(url),init});
    return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
  }});
  const handler=createMcpHandler(client);
  const call=async(args={view:'summary'})=>{
    const response=await handler({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'ziwei_phone_mcp_setup',arguments:args}});
    return {response,text:response.result?.content?.[0]?.text,value:response.result?JSON.parse(response.result.content[0].text):null};
  };
  return {handler,call,requests};
}

test('phone setup advertises summary for readonly control directory counts while keeping full available',async()=>{
  const {handler}=setup(directory());
  const response=await handler({jsonrpc:'2.0',id:1,method:'tools/list'});
  const tool=response.result.tools.find(row=>row.name==='ziwei_phone_mcp_setup');
  assert.deepEqual(tool.inputSchema.properties.view.enum,['summary','full']);
  assert.match(tool.description,/summary/);
  assert.match(tool.description,/只读|数量|统计/);
});

test('summary keeps complete counts ahead of small phone metadata and omits huge setup content',async()=>{
  const large='PRIVATE_FULL_SETUP_DETAILS_'.repeat(30000);
  const payload=directory({skill:{instructions:large},computers:Array.from({length:4},(_,i)=>({id:'pc-'+i,runtimes:[{instructions:large}]})),employees:Array.from({length:3},(_,i)=>({id:'employee-'+i,instructions:large})),phones:[{id:'phone-1',alias:'甲',status:'online',nodes:[{debug:large}]},{id:'phone-2',alias:'乙',status:'offline',snapshot:large}]});
  const {call}=setup(payload);const {value,text,response}=await call();
  assert.deepEqual(value.counts,{phones:2,employees:3,computers:4});
  assert.equal(value.workspace,'summary-qa');assert.equal(value.source,'control_catalog');assert.equal(value.scope,'control_catalog');
  assert.equal(value.phoneCountStatus,'ready');assert.equal(value.api.status,'healthy');
  assert.deepEqual(value.phones,[{id:'phone-1',alias:'甲',status:'online'},{id:'phone-2',alias:'乙',status:'offline'}]);
  assert.equal(value.phoneList.truncated,false);assert.equal(value.phoneList.shown,2);
  assert.ok(text.indexOf('"counts"')<text.indexOf('"phones": ['));
  assert.doesNotMatch(text,/PRIVATE_FULL_SETUP_DETAILS|instructions|runtimes|snapshot|nodes/);
  assert.ok(Buffer.byteLength(text,'utf8')<=6*1024);assert.ok(Buffer.byteLength(JSON.stringify(response),'utf8')<=8*1024);
});

test('summary strips its client-only view without changing one GET, bearer or explicit workspace',async()=>{
  const {call,requests}=setup(directory({workspace:'other-qa'}));await call({view:'summary',workspace:'other-qa'});
  assert.equal(requests.length,1);assert.equal(requests[0].url,'https://fixture.test/mcp/v1/workspaces/other-qa/phone-mcp/setup');
  assert.equal(requests[0].init.method,'GET');assert.equal(requests[0].init.body,undefined);
  assert.equal(requests[0].init.headers.authorization,'Bearer '+TOKEN);
  assert.equal(new URL(requests[0].url).search,'');
});

test('oversized or escaped explicit JSON workspaces retain the existing pre-request route rejection',async()=>{
  for(const workspace of ['大'.repeat(20000),'"\\'.repeat(20000)]){
    const {call,requests}=setup(directory());const {response}=await call({view:'summary',workspace});
    assert.match(response.error.message,/工作区标识无效/);assert.equal(requests.length,0);
  }
});

test('summary bounds its workspace display independently of routing even with an empty phone list',async()=>{
  for(const display of ['大😀'.repeat(20000),'"\\'.repeat(20000)]){
    let readings=0;
    const workspace={toString:()=>++readings===1?'summary-qa':display};
    const {call,requests}=setup(directory({phones:[]}));const {value,text,response}=await call({view:'summary',workspace});
    assert.equal(requests.length,1);assert.equal(requests[0].url,'https://fixture.test/mcp/v1/workspaces/summary-qa/phone-mcp/setup');
    assert.deepEqual(value.counts,{phones:0,employees:1,computers:1});assert.equal(value.workspaceTruncated,true);
    assert.ok(Buffer.byteLength(value.workspace,'utf8')<=128);assert.equal(value.phoneList.shown,0);assert.equal(value.phoneList.truncated,false);
    assert.ok(Buffer.byteLength(text,'utf8')<=6*1024);assert.ok(Buffer.byteLength(JSON.stringify(response),'utf8')<=8*1024);
  }
});

test('default phone setup preserves the full object including all original fields',async()=>{
  const payload=directory({skill:{contents:'full config'},computers:[{runtimes:['Codex']}],phones:[{id:'p',nodes:[1],control:{ready:true}}],employees:[{instructions:'original instructions'}],extra:{config:'preserved'}});
  const {call,requests}=setup(payload);const {value}=await call({});
  assert.deepEqual(value,payload);assert.equal(requests.length,1);assert.ok(!requests[0].url.includes('view'));
});

test('explicit full preserves unhealthy and malformed source objects without summary transformations',async()=>{
  const payload=directory({phones:{not:'an array'},api:{status:'unavailable',error:'real failure'}});
  const {call,requests}=setup(payload);const {value}=await call({view:'full'});
  assert.deepEqual(value,payload);assert.equal(requests.length,1);assert.equal(new URL(requests[0].url).search,'');
});

test('summary bounds pretty UTF8 JSON for many multibyte aliases and escaped metadata without losing counts',async()=>{
  const payload=directory({workspace:'巨'.repeat(5000),phones:Array.from({length:1000},(_,i)=>({id:`phone-${i}-`+'长'.repeat(500),alias:'😀\n"\\中'.repeat(10000),status:'在'.repeat(1000)})),api:{status:'healthy',error:null}});
  const {call}=setup(payload);const {value,text,response}=await call();
  assert.equal(value.counts.phones,1000);assert.ok(value.phones.length<=20);assert.ok(value.phones.length>0);
  assert.equal(value.phoneList.truncated,true);assert.equal(value.phoneList.fieldsTruncated,true);assert.equal(value.phoneList.shown,value.phones.length);
  assert.ok(Buffer.byteLength(text,'utf8')<=6*1024);assert.ok(Buffer.byteLength(JSON.stringify(response),'utf8')<=8*1024);
  assert.ok(value.phones.every(phone=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(phone.alias)));
});

test('summary deduplicates actual nonempty phone ids instead of counting computer nodes or employee bindings',async()=>{
  const payload=directory({phones:[{id:'phone-1',alias:'first',status:'online'},{id:'phone-1',alias:'duplicate',status:'offline'},{id:'phone-2',alias:'second',status:'online'}],computers:[{id:'pc',nodes:[1,2,3]}],employees:[{id:'e',phone_mcp:{phone_device_id:'phone-3'}}]});
  const {call}=setup(payload);const {value}=await call();
  assert.deepEqual(value.counts,{phones:2,employees:1,computers:1});
  assert.deepEqual(value.phones.map(phone=>phone.id),['phone-1','phone-2']);assert.equal(value.phones[0].alias,'first');
});

test('healthy empty control catalog has a known zero phone count',async()=>{
  const {call}=setup(directory({phones:[]}));const {value}=await call();
  assert.equal(value.counts.phones,0);assert.equal(value.phoneCountStatus,'ready');assert.deepEqual(value.phones,[]);assert.equal(value.phoneList.truncated,false);
});

test('unavailable phone API reports unknown even if server returns an empty array',async()=>{
  const {call}=setup(directory({phones:[],api:{status:'unavailable',error:'upstream unreachable '+ '大'.repeat(10000)}}));const {value,text}=await call();
  assert.equal(value.counts.phones,null);assert.equal(value.phoneCountStatus,'failed');assert.equal(value.phoneCountReason,'phone_api_unavailable');
  assert.equal(value.api.status,'unavailable');assert.ok(value.api.error.includes('upstream unreachable'));assert.ok(Buffer.byteLength(text,'utf8')<=6*1024);
});

test('explicit unavailable API signal overrides a healthy label and cannot fabricate zero',async()=>{
  const {call}=setup(directory({phones:[],api:{status:'healthy',available:false,error:null}}));const {value}=await call();
  assert.equal(value.counts.phones,null);assert.equal(value.phoneCountStatus,'failed');assert.equal(value.phoneCountReason,'phone_api_unavailable');assert.equal(value.api.available,false);
});

test('malformed phone arrays or missing ids fail explicitly without invented identities or a zero count',async()=>{
  for(const phones of [null,{},'bad',[null],['bad'],[{}],[{id:''}],[{id:'   '}],[{id:7}],[{id:'valid'},{alias:'missing id'}]]){
    const {call}=setup(directory({phones}));const {value}=await call();
    assert.equal(value.counts.phones,null);assert.equal(value.phoneCountStatus,'failed');assert.equal(value.phoneCountReason,'invalid_phone_directory');assert.deepEqual(value.phones,[]);
  }
  const {phones:_phones,...missing}=directory();const {call}=setup(missing);assert.equal((await call()).value.counts.phones,null);
});

test('missing or invalid API health cannot turn a phone directory into a known count',async()=>{
  for(const api of [undefined,null,{},'healthy',{status:'unknown'},{status:'healthy',error:'failure despite status'}]){
    const {call}=setup(directory({api}));const {value}=await call();
    assert.equal(value.counts.phones,null);assert.equal(value.phoneCountStatus,'failed');
  }
});

test('invalid visible employee or computer arrays yield unknown counts independently of a valid phone directory',async()=>{
  const {call}=setup(directory({employees:null,computers:{not:'an array'}}));const {value}=await call();
  assert.deepEqual(value.counts,{phones:1,employees:null,computers:null});assert.equal(value.phoneCountStatus,'ready');
});

test('malformed entries in visible employee or computer arrays cannot produce a fabricated count',async()=>{
  for(const entries of [[null],['bad'],[[]],[{}],[{id:''}]]){
    const {call}=setup(directory({employees:entries,computers:entries}));const {value}=await call();
    assert.deepEqual(value.counts,{phones:1,employees:null,computers:null});
  }
});

test('summary also bounds the escaped JSON-RPC packet for quote and backslash heavy fields',async()=>{
  const {call}=setup(directory({phones:Array.from({length:100},(_,i)=>({id:`${i}-`+'"\\'.repeat(2000),alias:'"\\'.repeat(2000),status:'"\\'.repeat(2000)}))}));
  const {value,text,response}=await call();
  assert.equal(value.counts.phones,100);assert.equal(value.phoneList.truncated,true);assert.equal(value.phoneList.fieldsTruncated,true);
  assert.equal(value.phoneList.shown,value.phones.length);assert.ok(Buffer.byteLength(text,'utf8')<=6*1024);assert.ok(Buffer.byteLength(JSON.stringify(response),'utf8')<=8*1024);
});

test('invalid view fails before a request while HTTP errors remain real JSON-RPC failures',async()=>{
  const fixture=setup(directory());const invalid=await fixture.call({view:'compact'});assert.ok(invalid.response.error);assert.equal(fixture.requests.length,0);
  const unavailable=setup({error:'service unavailable'},{status:503});const result=await unavailable.call();assert.ok(result.response.error);assert.match(result.response.error.message,/service unavailable/);assert.equal(result.value,null);assert.equal(unavailable.requests.length,1);
});
