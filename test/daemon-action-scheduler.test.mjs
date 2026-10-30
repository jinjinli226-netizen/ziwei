import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionScheduler} from '../src/daemon-action-scheduler.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const action=(id,employeeId,type='task.execute')=>({id,type,workspace_id:'workspace-one',payload:{employeeId,deviceId:'device-one'}});
const child=(id,employeeId,parent)=>({...action(id,employeeId,'conversation.execute'),payload:{...action(id,employeeId).payload,collaboration:{sourceActionId:parent.id,sourceEmployeeId:parent.payload.employeeId,mode:'delegate',messageId:'message-'+id,fingerprint:'a'.repeat(64),groupId:null,nativeTask:null}}});
const dshNative=(id,employeeId,resource='groups',operation='send')=>({id,type:'employee.dsh.operation',workspace_id:'workspace-one',payload:{deviceId:'device-one',dshOperation:{schemaVersion:1,subject:{workspaceId:'workspace-one',workspace:'one',employeeId,deviceId:'device-one',runtime:'DSH',profile:'bot-'+employeeId},scope:resource==='groups'?{kind:'group',groupId:'g-native'}:{kind:'bot'},resource,operation,input:resource==='groups'?{groupId:'g-native',content:'Discuss'}:{},groupMembers:[{employeeId:'A',profile:'bot-A'},{employeeId:'B',profile:'bot-B'}]}}});
const dshGroupChild=(id,employeeId,parent)=>({...action(id,employeeId,'conversation.execute'),payload:{...action(id,employeeId).payload,runtime:'DSH',profile:'bot-'+employeeId,dshGroup:{schemaVersion:1,sourceActionId:parent.id,groupId:'g-native',memberProfile:'bot-'+employeeId}}});

const kinds={
 conversation:(id,employee)=>action(id,employee,'conversation.execute'),
 creator:(id,employee)=>({...action(id,employee),payload:{...action(id,employee).payload,employeeTemplateId:'ziwei-employee-creator'}}),
 group:(id,employee)=>({...action(id,employee,'hermes.bot.native'),payload:{...action(id,employee).payload,nativeOperation:{resource:'groups',operation:'step'}}}),
 collaborationGroup:(id,employee)=>({...action(id,employee,'hermes.bot.native'),payload:{...action(id,employee).payload,nativeOperation:{resource:'collaboration',operation:'message',input:{mode:'group'}}}}),
};

for(const[kind,make]of Object.entries(kinds))test(`two ${kind} parents run in parallel and leave the third slot for their actual children`,async t=>{
 const one=deferred(),two=deferred();t.after(()=>{one.resolve();two.resolve();});const calls=[];
 const p1=make('parent1','P1'),p2=make('parent2','P2'),p3=make('parent3','P3');
 const scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);if(a.id==='parent1')await one.promise;else if(a.id==='parent2')await two.promise;else if(a.id==='child1')one.resolve();else if(a.id==='child2')two.resolve();}});
 assert.deepEqual(scheduler.schedule([p1,p2,p3]),['parent1','parent2']);await flush();assert.deepEqual(calls,['parent1','parent2']);assert.equal(scheduler.activeCount,2);
 assert.deepEqual(scheduler.schedule([p3,child('child1','C1',p1),child('child2','C2',p2)]),['child1']);assert.equal(scheduler.activeCount,3);await flush();assert.deepEqual(calls,['parent1','parent2','child1']);
 assert.deepEqual(scheduler.schedule([p3,child('child2','C2',p2)]),['child2','parent3']);assert.equal(scheduler.activeCount,3);await scheduler.whenIdle();assert.deepEqual(calls,['parent1','parent2','child1','child2','parent3']);assert.equal(scheduler.activeCount,0);
});

test('a third independent conversation starts after either of the first two employees releases its parent slot',async t=>{
 const running=deferred();t.after(()=>running.resolve());const calls=[];const scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);if(a.id!=='third')await running.promise;}});
 const first=action('first','A','conversation.execute'),second=action('second','B','conversation.execute'),third=action('third','C','conversation.execute');
 assert.deepEqual(scheduler.schedule([first,second,third]),['first','second']);await flush();assert.deepEqual(calls,['first','second']);running.resolve();await scheduler.whenIdle();assert.deepEqual(scheduler.schedule([third]),['third']);await scheduler.whenIdle();assert.deepEqual(calls,['first','second','third']);
});

test('ordinary non-parent work can use all three bounded worker slots',async t=>{
 const release=deferred();t.after(()=>release.resolve());const calls=[];const scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);await release.promise;}});
 assert.deepEqual(scheduler.schedule([action('one','A'),action('two','B'),action('three','C'),action('four','D')]),['one','two','three']);await flush();assert.equal(calls.length,3);assert.equal(scheduler.activeCount,3);release.resolve();await scheduler.whenIdle();
});

test('the same employee stays ordered while different employees use their available slots',async t=>{
 const release=deferred();t.after(()=>release.resolve());const calls=[];const scheduler=createActionScheduler({concurrency:3,execute:async a=>{calls.push(a.id);await release.promise;}});
 assert.deepEqual(scheduler.schedule([action('a1','A','conversation.execute'),action('a2','A','conversation.execute'),action('b1','B','conversation.execute')]),['a1','b1']);await flush();assert.deepEqual(calls,['a1','b1']);release.resolve();await scheduler.whenIdle();assert.deepEqual(scheduler.schedule([action('a2','A','conversation.execute')]),['a2']);await scheduler.whenIdle();
});

test('ordinary task employees remain serialized independently of parent reservations',async t=>{
 const release=deferred();t.after(()=>release.resolve());const calls=[];const scheduler=createActionScheduler({concurrency:2,execute:async a=>{calls.push(a.id);await release.promise;}});
 assert.deepEqual(scheduler.schedule([action('a1','A'),action('a2','A'),action('b1','B'),action('c1','C')]),['a1','b1']);await flush();assert.equal(scheduler.activeCount,2);release.resolve();await scheduler.whenIdle();scheduler.schedule([action('a2','A'),action('c1','C')]);await scheduler.whenIdle();assert.deepEqual(calls,['a1','b1','a2','c1']);
});

test('an actual child takes the free worker slot ahead of unrelated work even when its parent was admitted in this poll',async t=>{
 const release=deferred();t.after(()=>release.resolve());const calls=[];const p=action('parent','P','conversation.execute');
 const scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);if(a.id==='parent')await release.promise;else if(a.id==='child')release.resolve();}});
 scheduler.schedule([p,action('ordinary1','A'),action('ordinary2','B'),child('child','C',p)]);await scheduler.whenIdle();assert.deepEqual(calls,['parent','child','ordinary1']);
 scheduler.schedule([action('ordinary2','B')]);await scheduler.whenIdle();assert.deepEqual(calls,['parent','child','ordinary1','ordinary2']);
});

for(const[name,mutate]of Object.entries({
 bareSourceTag:a=>{a.payload.collaboration={sourceActionId:'parent1'};},
 missingSource:a=>{a.payload.collaboration.sourceActionId='not-active';},
 wrongSourceEmployee:a=>{a.payload.collaboration.sourceEmployeeId='wrong';},
 sameEmployee:a=>{a.payload.employeeId='P1';},
 otherWorkspace:a=>{a.workspace_id='workspace-other';},
 otherDevice:a=>{a.payload.deviceId='device-other';},
 missingMode:a=>{delete a.payload.collaboration.mode;},
 missingMessage:a=>{delete a.payload.collaboration.messageId;},
 missingFingerprint:a=>{delete a.payload.collaboration.fingerprint;},
 malformedFingerprint:a=>{a.payload.collaboration.fingerprint='pretend';},
 structuredFingerprint:a=>{a.payload.collaboration.fingerprint={toString:'not callable'};},
 creatorParent:a=>{a.payload.employeeTemplateId='ziwei-employee-creator';},
}))test(`a ${name} collaboration tag cannot bypass the parent budget`,async t=>{
 const release=deferred();t.after(()=>release.resolve());const calls=[],p1=action('parent1','P1','conversation.execute'),p2=action('parent2','P2','conversation.execute');
 const scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);await release.promise;}});scheduler.schedule([p1,p2]);await flush();const candidate=child('forged-child','C',p1);mutate(candidate);assert.deepEqual(scheduler.schedule([candidate]),[]);assert.equal(scheduler.activeCount,2);assert.deepEqual(calls,['parent1','parent2']);release.resolve();await scheduler.whenIdle();
});

test('a completed source action cannot lend a parent slot to a tagged conversation',async t=>{
 const release=deferred();t.after(()=>release.resolve());const old=action('old','OLD','conversation.execute'),scheduler=createActionScheduler({execute:async a=>{if(a.id!=='old')await release.promise;}});scheduler.schedule([old]);await scheduler.whenIdle();scheduler.schedule([action('one','A','conversation.execute'),action('two','B','conversation.execute')]);assert.deepEqual(scheduler.schedule([child('late','C',old)]),[]);release.resolve();await scheduler.whenIdle();
});

test('one cancellation bypasses both occupied parent slots, the worker slot and employee serialization',async t=>{
 const running=deferred(),control=deferred();t.after(()=>{running.resolve();control.resolve();});const calls=[];const scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);await (a.type==='action.cancel'?control.promise:running.promise);}});
 scheduler.schedule([action('p1','A','conversation.execute'),action('p2','B','conversation.execute'),action('worker','C')]);await flush();assert.equal(scheduler.activeCount,3);
 assert.deepEqual(scheduler.schedule([action('stop','A','action.cancel'),action('extra-stop','D','action.cancel'),action('other','D')]),['stop']);await flush();assert.deepEqual(calls,['p1','p2','worker','stop']);assert.equal(scheduler.activeCount,4);control.resolve();await flush();assert.deepEqual(scheduler.schedule([action('extra-stop','D','action.cancel')]),['extra-stop']);running.resolve();await scheduler.whenIdle();
});

test('concurrency one remains strictly sequential and has no implicit parent/child overcommit',async t=>{
 const release=deferred();t.after(()=>release.resolve());const p=action('parent','P','conversation.execute'),calls=[],scheduler=createActionScheduler({concurrency:1,execute:async a=>{calls.push(a.id);if(a.id==='parent')await release.promise;}});
 scheduler.schedule([p]);await flush();assert.deepEqual(scheduler.schedule([child('child','C',p)]),[]);assert.equal(scheduler.activeCount,1);release.resolve();await scheduler.whenIdle();assert.deepEqual(scheduler.schedule([child('child','C',p)]),['child']);await scheduler.whenIdle();assert.deepEqual(calls,['parent','child']);
});

test('repeated polls never execute or acknowledge an active action twice',async t=>{
 const release=deferred();t.after(()=>release.resolve());let calls=0;const scheduler=createActionScheduler({execute:async()=>{calls++;await release.promise;}}),a=action('same','A');scheduler.schedule([a,a]);scheduler.schedule([a]);await flush();assert.equal(calls,1);release.resolve();await scheduler.whenIdle();
});

test('execution errors release employee, parent and capacity counters even if the error observer also throws',async()=>{
 const calls=[],failures=[],scheduler=createActionScheduler({concurrency:2,execute:async a=>{calls.push(a.id);if(a.id==='bad')throw new Error('request failed');},onError:(error,a)=>{failures.push([a.id,error.message]);throw Error('observer failed');}});
 scheduler.schedule([action('bad','A','conversation.execute')]);await scheduler.whenIdle();assert.equal(scheduler.activeCount,0);scheduler.schedule([action('good','A','conversation.execute')]);await scheduler.whenIdle();assert.deepEqual(calls,['bad','good']);assert.deepEqual(failures,[['bad','request failed']]);
});

test('canStart exceptions and admission revocation do not leak reserved counters',async()=>{
 const failures=[],calls=[];let allowed=false,checks=0;const scheduler=createActionScheduler({concurrency:1,execute:async a=>calls.push(a.id),canStart:a=>{if(a.id==='throws')throw Error('admission failed');if(a.id==='revoked')return ++checks===1;return allowed;},onError:(_error,a)=>failures.push(a.id)});
 assert.deepEqual(scheduler.schedule([action('throws','A','conversation.execute')]),[]);assert.deepEqual(failures,['throws']);assert.deepEqual(scheduler.schedule([action('revoked','A','conversation.execute')]),['revoked']);await scheduler.whenIdle();assert.deepEqual(calls,[]);assert.equal(scheduler.activeCount,0);allowed=true;assert.deepEqual(scheduler.schedule([action('good','A','conversation.execute')]),['good']);await scheduler.whenIdle();assert.deepEqual(calls,['good']);
});

test('invalid budgets and callbacks are rejected before any work can be scheduled',()=>{
 for(const concurrency of[0,-1,9,1.1,'3',null,NaN,Infinity])assert.throws(()=>createActionScheduler({execute:async()=>{},concurrency}),TypeError);
 assert.throws(()=>createActionScheduler(),TypeError);for(const name of['onError','canStart','quarantinedActionIds'])assert.throws(()=>createActionScheduler({execute:async()=>{},[name]:null}),TypeError);
});

test('the parent bound follows the configured total budget and never silently doubles it',async t=>{
 for(const concurrency of[2,3,4,8]){const release=deferred();t.after(()=>release.resolve());const scheduler=createActionScheduler({concurrency,execute:()=>release.promise}),parents=Array.from({length:10},(_,i)=>action('p'+i,'P'+i,'conversation.execute'));
  assert.equal(scheduler.schedule(parents).length,concurrency-1);assert.equal(scheduler.activeCount,concurrency-1);assert.deepEqual(scheduler.schedule([action('worker','W'),action('extra','X')]),['worker']);assert.equal(scheduler.activeCount,concurrency);release.resolve();await scheduler.whenIdle();}
});


test('a quarantine arriving between scheduling and execution skips work and releases every reserved counter',async()=>{
 let quarantined=false;const calls=[];const scheduler=createActionScheduler({execute:async a=>calls.push(a.id),canStart:()=>!quarantined,quarantinedActionIds:()=>quarantined?['old-quarantine']:[]});
 assert.deepEqual(scheduler.schedule([action('paused','A','conversation.execute')]),['paused']);quarantined=true;await scheduler.whenIdle();assert.deepEqual(calls,[]);assert.equal(scheduler.activeCount,1);quarantined=false;assert.equal(scheduler.activeCount,0);assert.deepEqual(scheduler.schedule([action('ready','A','conversation.execute')]),['ready']);await scheduler.whenIdle();assert.deepEqual(calls,['ready']);
});

test('one admission callback failure does not prevent other employees in that poll from starting',async()=>{
 const calls=[],failures=[],scheduler=createActionScheduler({execute:async a=>calls.push(a.id),canStart:a=>{if(a.id==='bad')throw Error('admission failed');return true;},onError:(_error,a)=>failures.push(a.id)});
 assert.deepEqual(scheduler.schedule([action('bad','A','conversation.execute'),action('good','B','conversation.execute')]),['good']);await scheduler.whenIdle();assert.deepEqual(calls,['good']);assert.deepEqual(failures,['bad']);assert.equal(scheduler.activeCount,0);
});

test('admission-denied entries do not block a permitted retry for the same employee',async()=>{
 const calls=[],failures=[],scheduler=createActionScheduler({execute:async a=>calls.push(a.id),canStart:a=>{if(a.id==='throws')throw Error('admission failed');return a.id==='durable-retry';},onError:(_error,a)=>failures.push(a.id)});
 assert.deepEqual(scheduler.schedule([action('new-action','A','conversation.execute'),action('throws','A','conversation.execute'),action('durable-retry','A','conversation.execute')]),['durable-retry']);await scheduler.whenIdle();assert.deepEqual(calls,['durable-retry']);assert.deepEqual(failures,['throws']);assert.equal(scheduler.activeCount,0);
});

test('a child cannot overlap its own source employee even while another parent slot is free',async t=>{
 const release=deferred();t.after(()=>release.resolve());const p=action('parent','P','conversation.execute'),calls=[],scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);await release.promise;}});
 scheduler.schedule([p]);await flush();assert.equal(scheduler.activeCount,1);assert.deepEqual(scheduler.schedule([child('same-employee','P',p),action('same-task','P')]),[]);assert.deepEqual(calls,['parent']);release.resolve();await scheduler.whenIdle();
});


test('a newer collaboration child never overtakes its employee earlier pending conversation',async t=>{
 const parentOne=deferred(),parentTwo=deferred(),head=deferred();t.after(()=>{parentOne.resolve();parentTwo.resolve();head.resolve();});const calls=[],p1=action('p1','P1','conversation.execute'),p2=action('p2','P2','conversation.execute'),a1=action('a1','C','conversation.execute'),c2=child('child2','C',p1);
 const scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);if(a.id==='p1')await parentOne.promise;else if(a.id==='p2')await parentTwo.promise;else if(a.id==='a1')await head.promise;else if(a.id==='child2')parentOne.resolve();}});
 scheduler.schedule([p1,p2]);await flush();assert.deepEqual(scheduler.schedule([a1,c2]),[],'a resource-blocked earlier message retains its employee queue head');await flush();assert.deepEqual(calls,['p1','p2']);
 parentTwo.resolve();await flush();assert.deepEqual(scheduler.schedule([a1,c2]),['a1']);await flush();assert.deepEqual(calls,['p1','p2','a1']);assert.deepEqual(scheduler.schedule([c2]),[]);head.resolve();await flush();assert.deepEqual(scheduler.schedule([c2]),['child2']);await scheduler.whenIdle();assert.deepEqual(calls,['p1','p2','a1','child2']);
});

test('native operations serialize by the bound subject employee instead of independent action ids',async t=>{
 const release=deferred();t.after(()=>release.resolve());const calls=[],scheduler=createActionScheduler({concurrency:3,execute:async a=>{calls.push(a.id);await release.promise;}});
 assert.deepEqual(scheduler.schedule([dshNative('settings-one','A','settings','mutate'),dshNative('settings-two','A','settings','mutate'),action('chat','A','conversation.execute'),action('other','B')]),['settings-one','other']);await flush();assert.deepEqual(calls,['settings-one','other']);release.resolve();await scheduler.whenIdle();assert.deepEqual(scheduler.schedule([dshNative('settings-two','A','settings','mutate'),action('chat','A','conversation.execute')]),['settings-two']);await scheduler.whenIdle();
});

test('one native group coordinator can await all members including itself with concurrency one',async t=>{
 const finish=deferred(),memberOne=deferred();t.after(()=>{finish.resolve();memberOne.resolve();});const calls=[],parent=dshNative('native-parent','A'),children=[dshGroupChild('native-a','A',parent),dshGroupChild('native-b','B',parent)];
 const scheduler=createActionScheduler({concurrency:1,execute:async a=>{calls.push(a.id);if(a.id===parent.id)await finish.promise;if(a.id==='native-a')await memberOne.promise;if(a.id==='native-b')finish.resolve();}});
 assert.deepEqual(scheduler.schedule([parent,...children]),['native-parent','native-a']);await flush();assert.deepEqual(calls,['native-parent','native-a']);assert.equal(scheduler.activeCount,2);assert.deepEqual(scheduler.schedule([children[1],action('ordinary','C')]),[]);memberOne.resolve();await flush();assert.deepEqual(scheduler.schedule([children[1],action('ordinary','C')]),['native-b']);await scheduler.whenIdle();assert.deepEqual(calls,['native-parent','native-a','native-b']);assert.equal(scheduler.activeCount,0);
});

test('the independent native group budget permits at most one coordinator and the original bounded workers',async t=>{
 const release=deferred();t.after(()=>release.resolve());const scheduler=createActionScheduler({concurrency:2,execute:()=>release.promise}),one=dshNative('native-one','A'),two=dshNative('native-two','B');
 assert.deepEqual(scheduler.schedule([one,two,action('worker-one','C'),action('worker-two','D'),action('worker-extra','E')]),['native-one','worker-one','worker-two']);assert.equal(scheduler.activeCount,3);assert.deepEqual(scheduler.schedule([two]),[]);release.resolve();await scheduler.whenIdle();assert.deepEqual(scheduler.schedule([two]),['native-two']);await scheduler.whenIdle();
});

test('native group children stay behind an earlier chat and never overlap their employee worker',async t=>{
 const parentEnd=deferred(),chatEnd=deferred();t.after(()=>{parentEnd.resolve();chatEnd.resolve();});const calls=[],p=dshNative('native-parent','A'),c=dshGroupChild('native-a','A',p),earlier=action('earlier-chat','A','conversation.execute');
 const scheduler=createActionScheduler({concurrency:1,execute:async a=>{calls.push(a.id);if(a.id===p.id)await parentEnd.promise;if(a.id===earlier.id)await chatEnd.promise;if(a.id===c.id)parentEnd.resolve();}});
 assert.deepEqual(scheduler.schedule([p,earlier,c]),['native-parent','earlier-chat']);await flush();assert.deepEqual(scheduler.schedule([c]),[]);chatEnd.resolve();await flush();assert.deepEqual(scheduler.schedule([action('unrelated','C'),c]),['native-a']);await scheduler.whenIdle();assert.deepEqual(calls,['native-parent','earlier-chat','native-a']);
});

for(const[name,mutate]of Object.entries({
 missingSource:a=>{a.payload.dshGroup.sourceActionId='inactive';},
 wrongGroup:a=>{a.payload.dshGroup.groupId='g-other';},
 wrongProfile:a=>{a.payload.dshGroup.memberProfile='bot-other';},
 wrongRuntime:a=>{a.payload.runtime='Hermes';},
 wrongVersion:a=>{a.payload.dshGroup.schemaVersion=2;},
 unboundEmployee:a=>{a.payload.employeeId='outside';a.payload.profile='bot-outside';a.payload.dshGroup.memberProfile='bot-outside';},
 otherWorkspace:a=>{a.workspace_id='workspace-other';},
 otherDevice:a=>{a.payload.deviceId='device-other';},
 creator:a=>{a.payload.employeeTemplateId='ziwei-employee-creator';},
}))test(`a ${name} DSH group tag cannot borrow native child priority or its parent reservation`,async t=>{
 const release=deferred();t.after(()=>release.resolve());const parent=dshNative('native-parent','A'),generic=action('generic-parent','C','conversation.execute'),candidate=dshGroupChild('candidate','B',parent),scheduler=createActionScheduler({concurrency:2,execute:()=>release.promise});
 assert.deepEqual(scheduler.schedule([parent,generic]),['native-parent','generic-parent']);mutate(candidate);assert.deepEqual(scheduler.schedule([candidate]),[]);release.resolve();await scheduler.whenIdle();
});

test('an exact native group child uses bounded worker capacity while its coordinator and another parent wait',async t=>{
 const release=deferred();t.after(()=>release.resolve());const parent=dshNative('native-parent','A'),generic=action('generic-parent','C','conversation.execute'),scheduler=createActionScheduler({concurrency:2,execute:()=>release.promise});
 assert.deepEqual(scheduler.schedule([parent,generic]),['native-parent','generic-parent']);assert.deepEqual(scheduler.schedule([dshGroupChild('native-b','B',parent),action('extra','D')]),['native-b']);assert.equal(scheduler.activeCount,3);release.resolve();await scheduler.whenIdle();
});

test('precise native controls bypass concurrency one during group work with only one control slot',async t=>{
 const release=deferred(),control=deferred();t.after(()=>{release.resolve();control.resolve();});const parent=dshNative('native-parent','A'),calls=[],scheduler=createActionScheduler({concurrency:1,execute:async a=>{calls.push(a.id);await(a.id.startsWith('control-')?control.promise:release.promise);}});
 assert.deepEqual(scheduler.schedule([parent,dshGroupChild('native-a','A',parent)]),['native-parent','native-a']);
 for(const[resource,operation]of[['interactions','list'],['interactions','approve'],['interactions','answer'],['interactions','dismiss'],['plugins','cancelInstall'],['groups','cancel']]){
  const one=dshNative(`control-${operation}`,'A',resource,operation),extra=dshNative('extra-control','B','groups','cancel');assert.deepEqual(scheduler.schedule([one,extra,dshNative('not-control','A','interactions','claim')]),[one.id]);assert.equal(scheduler.activeCount,3);control.resolve();await flush();
 }
 release.resolve();await scheduler.whenIdle();assert.equal(calls.filter(id=>id.startsWith('control-')).length,6);
});

test('native coordinator execution failure releases its independent reservation and leaves employee workers usable',async()=>{
 const calls=[],scheduler=createActionScheduler({concurrency:1,execute:async a=>{calls.push(a.id);if(a.id==='bad-native')throw Error('group request failed');}});
 scheduler.schedule([dshNative('bad-native','A')]);await scheduler.whenIdle();assert.deepEqual(scheduler.schedule([dshNative('next-native','A'),action('chat','A')]),['next-native','chat']);await scheduler.whenIdle();assert.equal(scheduler.activeCount,0);assert.deepEqual(calls,['bad-native','next-native','chat']);
});

test('a completed native coordinator cannot lend priority or a worker reservation to a later tagged child',async t=>{
 const release=deferred();t.after(()=>release.resolve());const old=dshNative('old-native','A'),scheduler=createActionScheduler({concurrency:2,execute:async a=>{if(a.id!==old.id)await release.promise;}});
 scheduler.schedule([old]);await scheduler.whenIdle();assert.deepEqual(scheduler.schedule([action('ordinary-parent','C','conversation.execute')]),['ordinary-parent']);assert.deepEqual(scheduler.schedule([dshGroupChild('late-child','B',old)]),[]);release.resolve();await scheduler.whenIdle();
});
