import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessageReadObserver} from './conversation-read.mjs';

function fixture(onVisible){
  const box=(top,bottom)=>({left:0,right:300,top,bottom});
  const row=(id,top,bottom)=>({id,isConnected:true,rect:box(top,bottom),getAttribute:name=>name==='data-message-id'?id:null,getBoundingClientRect(){return this.rect;}});
  const a=row('a',10,80),b=row('b',80,150),c=row('c',450,520),rows=[a,b,c],observed=new Set(),listeners=new Map(),calls=[];
  const document={visibilityState:'visible',defaultView:{innerWidth:1000,innerHeight:500},addEventListener:(event,callback)=>listeners.set(event,callback),removeEventListener:(event,callback)=>{if(listeners.get(event)===callback)listeners.delete(event);}};
  const root={isConnected:true,querySelectorAll:()=>rows,contains:element=>rows.includes(element),getBoundingClientRect:()=>box(0,400)};
  let callback,disconnected=false;
  class Observer{constructor(next,options){callback=next;assert.equal(options.root,root);}observe(target){observed.add(target);}unobserve(target){observed.delete(target);}disconnect(){disconnected=true;observed.clear();}}
  const cleanup=createMessageReadObserver(root,id=>{calls.push(id);return onVisible?.(id);},{document,IntersectionObserver:Observer});
  const intersect=(target,visible=true)=>({target,isIntersecting:visible,intersectionRatio:visible?1:0});
  return {a,b,c,rows,root,document,calls,observed,listeners,cleanup,intersect,deliver:entries=>callback(entries),disconnected:()=>disconnected};
}

test('mount does not mark any messages and observer chooses the final visible row in DOM order',()=>{
  const f=fixture();assert.deepEqual(f.calls,[]);
  f.deliver([f.intersect(f.b),f.intersect(f.a),f.intersect(f.c)]);
  assert.deepEqual(f.calls,['b']); // c is below the scroll container, even if an old entry says intersecting.
  f.deliver([f.intersect(f.a)]);assert.deepEqual(f.calls,['b']);
  f.cleanup();assert.equal(f.disconnected(),true);
});

test('hidden documents remain unread and foregrounding rechecks current geometry',()=>{
  const f=fixture();f.document.visibilityState='hidden';f.deliver([f.intersect(f.a),f.intersect(f.b)]);assert.deepEqual(f.calls,[]);
  f.b.rect={left:0,right:300,top:600,bottom:700};f.document.visibilityState='visible';f.listeners.get('visibilitychange')();assert.deepEqual(f.calls,['a']);
  f.cleanup();
});

test('zero intersections, hidden elements and offscreen roots do not mark read',()=>{
  const f=fixture();f.deliver([{target:f.a,isIntersecting:true,intersectionRatio:0}]);assert.deepEqual(f.calls,[]);
  f.a.rect={left:0,right:0,top:0,bottom:0};f.deliver([f.intersect(f.a)]);assert.deepEqual(f.calls,[]);
  f.root.getBoundingClientRect=()=>({left:1001,right:1301,top:0,bottom:400});f.deliver([f.intersect(f.b)]);assert.deepEqual(f.calls,[]);f.cleanup();
});

test('cleanup suppresses queued intersection and visibility callbacks',()=>{
  const f=fixture(),lateVisibility=f.listeners.get('visibilitychange');f.document.visibilityState='hidden';f.deliver([f.intersect(f.b)]);
  f.cleanup();f.document.visibilityState='visible';lateVisibility();f.deliver([f.intersect(f.a)]);f.cleanup.update();assert.deepEqual(f.calls,[]);assert.equal(f.listeners.size,0);
});

test('update observes new rows without marking them and ignores removed row callbacks',()=>{
  const f=fixture();f.rows.splice(0,1);f.cleanup.update();assert.equal(f.observed.has(f.a),false);
  f.deliver([f.intersect(f.a)]);assert.deepEqual(f.calls,[]);
  f.deliver([f.intersect(f.b)]);assert.deepEqual(f.calls,['b']);
  const next={...f.a,id:'d',getAttribute:()=> 'd'};f.rows.push(next);f.cleanup.update();assert.deepEqual(f.calls,['b']);assert.equal(f.observed.has(next),true);
  f.deliver([f.intersect(next)]);assert.deepEqual(f.calls,['b','d']);f.cleanup();
});

test('unsupported observers do not fall back to marking every mounted message',()=>{
  let reads=0;const document={visibilityState:'visible',addEventListener(){assert.fail('must not subscribe without observer');}};
  const cleanup=createMessageReadObserver({querySelectorAll:()=>[]},()=>reads++,{document,IntersectionObserver:undefined});
  cleanup.update();cleanup();assert.equal(reads,0);
});

test('failed read callbacks retry only on a later visibility event',async()=>{
  for(const fail of [()=>false,()=>Promise.resolve(false),()=>Promise.reject(new Error('offline')),()=>{throw new Error('offline');}]){
    let count=0;const f=fixture(()=>++count===1?fail():true);
    f.deliver([f.intersect(f.b)]);await Promise.resolve();await Promise.resolve();
    assert.deepEqual(f.calls,['b']);
    f.deliver([f.intersect(f.b)]);assert.deepEqual(f.calls,['b','b']);
    await Promise.resolve();f.deliver([f.intersect(f.b)]);assert.deepEqual(f.calls,['b','b']);f.cleanup();
  }
});

test('foregrounding rechecks an already confirmed visible row without an automatic retry loop',()=>{
  const f=fixture(()=>true);f.deliver([f.intersect(f.b)]);
  f.document.visibilityState='hidden';f.listeners.get('visibilitychange')();assert.deepEqual(f.calls,['b']);
  f.document.visibilityState='visible';f.listeners.get('visibilitychange')();assert.deepEqual(f.calls,['b','b']);
  f.deliver([f.intersect(f.b)]);assert.deepEqual(f.calls,['b','b']);f.cleanup();
});

test('a late failure cannot clear the newer message or newer attempt deduplication',async()=>{
  let rejectOld;const prior=new Promise((resolve,reject)=>{rejectOld=reject;});let requests=0;
  const f=fixture(()=>++requests===1?prior:true);
  f.deliver([f.intersect(f.a)]);f.deliver([f.intersect(f.b)]);rejectOld(new Error('late'));await Promise.resolve();
  f.deliver([f.intersect(f.b)]);assert.deepEqual(f.calls,['a','b']);f.cleanup();
  let finishOld;const samePrior=new Promise(resolve=>{finishOld=resolve;});requests=0;
  const g=fixture(()=>++requests===1?samePrior:true);g.deliver([g.intersect(g.b)]);
  g.listeners.get('visibilitychange')();finishOld(false);await Promise.resolve();g.deliver([g.intersect(g.b)]);
  assert.deepEqual(g.calls,['b','b']);g.cleanup();
});
