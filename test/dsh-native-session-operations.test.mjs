import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDshNativeSessionOperation} from '../src/dsh-native-session-operations.mjs';

const scope={kind:'conversation',conversationId:'platform-conversation',nativeSessionId:'native-session'};
const subject={workspace:'test',employeeId:'employee',deviceId:'pc',runtime:'DSH',profile:'bot'};
const projection=values=>({kind:'sequenced',asOfSeq:12,values});
function run(resource,operation,input,responses){
 const calls=[];
 const result=executeDshNativeSessionOperation({resource,operation,input,scope,subject,rpc:async(method,args)=>{
  calls.push({method,args});const next=responses.shift();assert.equal(method,next.method);if(next.error)throw next.error;return next.value;
 }});
 return{result,calls};
}

test('session projection retains plan and question details but excludes unknown projection namespaces',async()=>{
 const values={agentPreset:'standard',plan:{active:true,pending:false,detail:'# Actual plan'},userQuestions:{active:[{callId:'call',questions:[{id:'q',question:'Choose',detail:'Full text',options:[{label:'A'}]}]}]},modelSelection:{next:{provider:'p',model:'m'}},sessionListMetadata:{blank:false},workingDirectory:'D:/native-work',title:'Native title',unreviewedPlugin:{credential:'private'}};
 const f=run('sessions','projections',{},[{method:'session/projections',value:projection(values)}]),result=await f.result;
 assert.equal(result.status,'observed');assert.equal(result.data.projections.values.userQuestions.active[0].questions[0].detail,'Full text');
 assert.equal(result.data.projections.values.plan.detail,'# Actual plan');assert.equal(result.data.projections.values.unreviewedPlugin,undefined);
 assert.equal(result.data.projections.values.workingDirectory,'D:/native-work');
 assert.deepEqual(f.calls[0].args,{request:{sessionId:'native-session'}});
});

test('nonblank sessions require an explicit new conversation before preset selection',async()=>{
 const f=run('presets','select',{agentPreset:'custom-mode'},[{method:'session/projections',value:projection({agentPreset:'standard',sessionListMetadata:{blank:false}})}]),result=await f.result;
 assert.equal(result.status,'failed');assert.equal(result.reasonCode,'DSH_PRESET_REQUIRES_NEW_CONVERSATION');assert.equal(f.calls.length,1);
});

test('preset selection requires native proof of blankness and readback of the requested preset',async()=>{
 const f=run('presets','select',{agentPreset:'custom-mode'},[
  {method:'session/projections',value:projection({agentPreset:'standard',sessionListMetadata:{blank:true}})},
  {method:'agentPresets/select',value:'custom-mode'},
  {method:'session/projections',value:projection({agentPreset:'custom-mode',sessionListMetadata:{blank:true}})},
 ]),result=await f.result;
 assert.equal(result.status,'applied');assert.equal(result.data.selected,'custom-mode');assert.equal(result.data.projections.values.agentPreset,'custom-mode');
 assert.deepEqual(f.calls[1].args,{agentId:'native-session',agentPreset:'custom-mode'});
 const unknown=run('presets','select',{agentPreset:'minimal'},[{method:'session/projections',value:projection({agentPreset:'standard'})}]);
 assert.equal((await unknown.result).status,'unknown');assert.equal(unknown.calls.length,1);
});

test('an unconfirmed preset write stays unknown instead of claiming the requested mode',async()=>{
 const f=run('presets','select',{agentPreset:'minimal'},[
  {method:'session/projections',value:projection({sessionListMetadata:{blank:true}})},
  {method:'agentPresets/select',value:'minimal'},
  {method:'session/projections',value:projection({agentPreset:'standard'})},
 ]);
 assert.equal((await f.result).status,'unknown');
});

test('Plan capabilities preserve the native command table and pending effective state',async()=>{
 const commands=[{name:'plan',description:'Native plan command'}],f=run('plan','capabilities',{},[
  {method:'commands/list',value:commands},{method:'session/projections',value:projection({plan:{active:true,pending:true}})},
 ]),result=await f.result;
 assert.equal(result.status,'observed');assert.deepEqual(result.data.commands,commands);assert.equal(result.data.available,true);assert.equal(result.data.effectiveActive,false);
 assert.deepEqual(f.calls[0].args,{agentId:'native-session'});
});

test('Plan desired state already effective performs no toggle',async()=>{
 const f=run('plan','set',{active:false},[{method:'session/projections',value:projection({plan:{active:true,pending:true}})}]),result=await f.result;
 assert.equal(result.status,'observed');assert.equal(result.data.effectiveActive,false);assert.equal(f.calls.length,1);
});

test('Plan writes only the fixed native command and confirms effective state from readback',async()=>{
 const f=run('plan','set',{active:true},[
  {method:'session/projections',value:projection({plan:{active:false,pending:false}})},
  {method:'commands/list',value:[{name:'plan'}]},
  {method:'commands/execute',value:{commandId:'cmd',result:{kind:'success'}}},
  {method:'session/projections',value:projection({plan:{active:false,pending:true}})},
 ]),result=await f.result;
 assert.equal(result.status,'applied');assert.equal(result.data.command.result.kind,'success');assert.equal(result.data.projections.values.plan.pending,true);
 assert.deepEqual(f.calls[2].args,{agentId:'native-session',line:'/plan',submittedAttachments:[]});
});

test('Plan command absence, rejection and mismatched readback are not reported as applied',async()=>{
 const absent=run('plan','set',{active:true},[
  {method:'session/projections',value:projection({plan:{active:false,pending:false}})},{method:'commands/list',value:[]},
 ]);assert.equal((await absent.result).status,'failed');assert.equal(absent.calls.length,2);
 const rejected=run('plan','set',{active:false},[
  {method:'session/projections',value:projection({plan:{active:true,pending:false}})},
  {method:'commands/list',value:[{name:'plan'}]},
  {method:'commands/execute',value:{commandId:'cmd',result:{kind:'error',text:'Cannot switch now'}}},
 ]);assert.equal((await rejected.result).status,'failed');assert.equal(rejected.calls[2].args.line,'/plan off');
 const mismatch=run('plan','set',{active:true},[
  {method:'session/projections',value:projection({plan:{active:false,pending:false}})},
  {method:'commands/list',value:[{name:'plan'}]},
  {method:'commands/execute',value:{commandId:'cmd',result:{kind:'success'}}},
  {method:'session/projections',value:projection({plan:{active:false,pending:false}})},
 ]);assert.equal((await mismatch.result).status,'unknown');assert.equal(mismatch.calls.length,4);
});

test('session model selection distinguishes selected next-turn default and last-used observations',async()=>{
 const selected={provider:'native-provider',model:'new-model',reasoningEffort:'high'},lastUsed={provider:'native-provider',model:'previous-model'};
 const f=run('models','selectSession',selected,[
  {method:'session/selectModel',value:{selected}},
  {method:'session/modelCatalog',value:{default:selected,providers:[]}},
  {method:'session/projections',value:projection({modelSelection:{next:selected,lastUsed}})},
 ]),result=await f.result;
 assert.equal(result.status,'applied');assert.deepEqual(result.data.selected,selected);assert.deepEqual(result.data.catalogDefault,selected);
 assert.deepEqual(result.data.projections.values.modelSelection.lastUsed,lastUsed);assert.deepEqual(result.data.layers,{selected:'confirmed',next:'confirmed',default:'confirmed'});
 assert.deepEqual(f.calls[0].args,{request:{sessionId:'native-session',...selected}});
});

test('a model default mismatch preserves confirmed next-turn selection as partial unknown',async()=>{
 const selected={provider:'p',model:'new'},f=run('models','selectSession',selected,[
  {method:'session/selectModel',value:{selected}},
  {method:'session/modelCatalog',value:{default:{provider:'p',model:'old'}}},
  {method:'session/projections',value:projection({modelSelection:{next:selected}})},
 ]),result=await f.result;
 assert.equal(result.status,'unknown');assert.equal(result.data.layers.next,'confirmed');assert.equal(result.data.layers.default,'unconfirmed');assert.deepEqual(result.data.selected,selected);
});

test('an unavailable model catalog does not hide confirmed next-turn readback',async()=>{
 const selected={provider:'p',model:'new'},f=run('models','selectSession',selected,[
  {method:'session/selectModel',value:{selected}},
  {method:'session/modelCatalog',error:Error('catalog unavailable')},
  {method:'session/projections',value:projection({modelSelection:{next:selected}})},
 ]),result=await f.result;
 assert.equal(result.status,'unknown');assert.equal(result.data.layers.selected,'confirmed');assert.equal(result.data.layers.next,'confirmed');assert.equal(result.data.layers.default,'unknown');
});

test('ambiguous mutation is never retried and raw native error text is not returned',async()=>{
 const f=run('models','selectSession',{provider:'p',model:'m'},[{method:'session/selectModel',error:Error('private credential returned by transport')}]),result=await f.result;
 assert.equal(result.status,'unknown');assert.equal(f.calls.length,1);assert.doesNotMatch(JSON.stringify(result),/private credential/);
});

test('session operations require the trusted conversation scope and reject unsupported operations',async()=>{
 let calls=0;
 const invalid=await executeDshNativeSessionOperation({resource:'plan',operation:'set',input:{active:true},scope:{kind:'bot'},subject,rpc:async()=>{calls++;}});
 assert.equal(invalid.status,'failed');assert.equal(calls,0);
 const unsupported=await executeDshNativeSessionOperation({resource:'commands',operation:'execute',input:{line:'/other'},scope,subject,rpc:async()=>{calls++;}});
 assert.equal(unsupported.status,'failed');assert.equal(calls,0);
});

test('native session list uses bot scope, filters subagents and preserves public cwd for ordinary sessions',async()=>{
 const calls=[],result=await executeDshNativeSessionOperation({resource:'sessions',operation:'list',input:{},scope:{kind:'bot'},subject,rpc:async(method,args)=>{
  calls.push({method,args});return{items:[
   {sessionId:'older',updatedAt:10,cwd:'D:/older',blank:false,projections:projection({workingDirectory:'D:/current'}),private:'hidden'},
   {sessionId:'child',updatedAt:100,parentSessionId:'older'},
   {sessionId:'subagent',updatedAt:100,origin:'subagent'},
   {sessionId:'newer',updatedAt:20,cwd:'D:/newer',blank:true},
  ]};
 }});
 assert.equal(result.status,'observed');assert.deepEqual(calls,[{method:'session/list',args:{_request:{}}}]);
 assert.deepEqual(result.data.items.map(item=>item.sessionId),['newer','older']);assert.equal(result.data.items[1].cwd,'D:/older');
 assert.equal(result.data.items[1].projections.values.workingDirectory,'D:/current');assert.equal(result.data.items[1].private,undefined);
});

test('native history reads one trusted session snapshot without invoking a unary stream RPC',async()=>{
 let requested;
 const records=[{type:'event',event:{type:'assistant/message',seq:3,data:{message:{content:[{type:'text',text:'Actual native response'}]}}}}];
 const result=await executeDshNativeSessionOperation({resource:'sessions',operation:'history',input:{maxMessages:200},scope,subject,rpc:async()=>assert.fail('history is a stream'),followSnapshot:async args=>{
  requested=args;return{type:'snapshot',hasMore:true,records,projections:projection({agentPreset:'standard',workingDirectory:'D:/native-work'}),assistantStream:{activeAttempt:null},unreviewedPlugin:'hidden'};
 }});
 assert.equal(result.status,'observed');assert.deepEqual(requested,{request:{address:{kind:'session',sessionId:'native-session'},assistantStream:true,maxMessages:200}});
 assert.deepEqual(result.data.snapshot.records,records);assert.equal(result.data.snapshot.hasMore,true);assert.equal(result.data.snapshot.projections.values.workingDirectory,'D:/native-work');assert.equal(result.data.snapshot.unreviewedPlugin,undefined);
});

test('history without a native snapshot never claims observed history',async()=>{
 for(const followSnapshot of [undefined,async()=>({type:'event',event:{}})]){
  const result=await executeDshNativeSessionOperation({resource:'sessions',operation:'history',input:{},scope,subject,rpc:async()=>assert.fail('no unary fallback'),followSnapshot});
  assert.equal(result.status,'unknown');assert.equal(result.reasonCode,'DSH_NATIVE_SESSION_HISTORY_UNAVAILABLE');
 }
});
