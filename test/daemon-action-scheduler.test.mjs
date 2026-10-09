import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionScheduler} from '../src/daemon-action-scheduler.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const action=(id,employeeId,type='task.execute')=>({id,type,payload:{employeeId}});

test('built-in Creator task parents reserve capacity for their child employees',async()=>{
 const release=deferred();const calls=[];
 const parent=id=>({...action(id,id),payload:{employeeId:id,employeeTemplateId:'ziwei-employee-creator'}});
 const scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);if(a.id==='parent1')await release.promise;else if(a.id==='child')release.resolve();}});
 scheduler.schedule([parent('parent1'),parent('parent2'),parent('parent3')]);await flush();
 assert.deepEqual(calls,['parent1']);
 scheduler.schedule([parent('parent2'),action('child','child_employee')]);await scheduler.whenIdle();
 assert.deepEqual(calls,['parent1','child']);
 scheduler.schedule([parent('parent2')]);await scheduler.whenIdle();assert.deepEqual(calls,['parent1','child','parent2']);
});

test('an executing Creator can wait for a different employee scheduled by the next poll',async()=>{
 const childFinished=deferred();const calls=[];
 const scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);if(a.id==='creator')await childFinished.promise;else childFinished.resolve();}});
 scheduler.schedule([action('creator','employee_creator','conversation.execute')]);await flush();
 assert.deepEqual(calls,['creator']);
 scheduler.schedule([action('creator','employee_creator','conversation.execute'),action('child','employee_child')]);
 await scheduler.whenIdle();assert.deepEqual(calls,['creator','child']);assert.equal(scheduler.activeCount,0);
});

test('multiple Creator conversations cannot consume the slots reserved for child verification tasks',async()=>{
 const release=deferred();const calls=[];
 const scheduler=createActionScheduler({execute:async a=>{calls.push(a.id);if(a.id==='parent1')await release.promise;else if(a.id==='child')release.resolve();}});
 scheduler.schedule([action('parent1','P1','conversation.execute'),action('parent2','P2','conversation.execute'),action('parent3','P3','conversation.execute')]);await flush();
 assert.deepEqual(calls,['parent1']);
 scheduler.schedule([action('parent2','P2','conversation.execute'),action('child','C')]);await scheduler.whenIdle();
 assert.deepEqual(calls,['parent1','child']);
 scheduler.schedule([action('parent2','P2','conversation.execute')]);await scheduler.whenIdle();assert.deepEqual(calls,['parent1','child','parent2']);
});

test('the same employee stays ordered while independent employees use bounded slots',async()=>{
 const release=deferred();const calls=[];
 const scheduler=createActionScheduler({concurrency:2,execute:async a=>{calls.push(a.id);await release.promise;}});
 scheduler.schedule([action('a1','A'),action('a2','A'),action('b1','B'),action('c1','C')]);await flush();
 assert.deepEqual(calls,['a1','b1']);assert.equal(scheduler.activeCount,2);
 release.resolve();await scheduler.whenIdle();
 scheduler.schedule([action('a2','A'),action('c1','C')]);await scheduler.whenIdle();
 assert.deepEqual(calls,['a1','b1','a2','c1']);
});

test('repeated polls do not execute or acknowledge the same active action twice',async()=>{
 const release=deferred();let calls=0;
 const scheduler=createActionScheduler({execute:async()=>{calls++;await release.promise;}});
 const a=action('same','A');scheduler.schedule([a,a]);scheduler.schedule([a]);await flush();
 assert.equal(calls,1);release.resolve();await scheduler.whenIdle();
});

test('a failed action releases its slot and reports a safe error through the caller',async()=>{
 const failures=[];const calls=[];
 const scheduler=createActionScheduler({concurrency:1,execute:async a=>{calls.push(a.id);if(a.id==='bad')throw new Error('request failed');},onError:(error,a)=>failures.push([a.id,error.message])});
 scheduler.schedule([action('bad','A')]);await scheduler.whenIdle();assert.equal(scheduler.activeCount,0);
 scheduler.schedule([action('good','A')]);await scheduler.whenIdle();assert.deepEqual(calls,['bad','good']);assert.deepEqual(failures,[['bad','request failed']]);
});
