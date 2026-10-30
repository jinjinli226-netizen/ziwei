import test from 'node:test';
import assert from 'node:assert/strict';
import {createDshNativeInteractionManager,executeDshNativeInteraction} from '../src/dsh-native-interactions.mjs';
const subject={workspace:'test',employeeId:'employee',deviceId:'pc',profile:'alpha'},scope={kind:'conversation',conversationId:'conversation',nativeSessionId:'session'};
test('live interaction handles stay bound to their original employee Bot and session',async()=>{
 const manager=createDshNativeInteractionManager(),calls=[];
 const detach=manager.attach({...subject,actionId:'original',conversationId:scope.conversationId,nativeSessionId:scope.nativeSessionId},{list:()=>[{interactionId:'opaque',kind:'approval'}],answer:async input=>{calls.push(input);return{accepted:true};}});
 const rpc=async()=>({values:{}});
 assert.equal((await executeDshNativeInteraction({operation:'approve',input:{interactionId:'opaque',decision:'allowed-once'},subject:{...subject,profile:'beta'},scope,rpc,manager})).status,'failed');
 assert.equal(calls.length,0);
 assert.equal((await executeDshNativeInteraction({operation:'approve',input:{interactionId:'opaque',decision:'allowed-once'},subject,scope,rpc,manager})).status,'applied');
 assert.equal(calls.length,1);detach();assert.equal((await executeDshNativeInteraction({operation:'list',subject,scope,rpc,manager})).data.requests.length,0);
});
test('continued questions supersede old waterfall identity and use only native userQuestions answer',async()=>{
 const calls=[],manager=createDshNativeInteractionManager();
 manager.attach({...subject,actionId:'original',conversationId:scope.conversationId,nativeSessionId:scope.nativeSessionId},{list:()=>[{interactionId:'old-live',kind:'question',callId:'question-call'}],answer:()=>assert.fail('continued question cannot use a stale waterfall')});
 const rpc=async(method,args)=>{calls.push({method,args});return method==='session/projections'?{values:{userQuestions:{active:[{callId:'question-call',state:'continued',questions:[{id:'q',question:'Plan?',detail:'full plan',intent:{kind:'plan-review',approve:'yes'}}]}]}}}:true;};
 const listed=await executeDshNativeInteraction({operation:'list',subject,scope,rpc,manager});assert.equal(listed.data.requests.length,1);assert.equal(listed.data.requests[0].questions[0].detail,'full plan');
 const result=await executeDshNativeInteraction({operation:'answer',input:{interactionId:'continued:question-call',answers:[{id:'q',selected:['yes']}]},subject,scope,rpc,manager});
 assert.equal(result.status,'applied');assert.equal(calls.at(-1).method,'userQuestions/answer');assert.equal(calls.at(-1).args.agentId,'session');
});
