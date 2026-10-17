import test from 'node:test';
import assert from 'node:assert/strict';
import { installMessageGestures, lastVisibleMessage } from '../web/message-gestures.js';

function fixture() {
  const handlers=new Map(),timers=new Map(),opened=[];let counter=0,enabled=true;
  const root={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name);}};
  const anchor={isConnected:true,dataset:{messageId:'original'},closest:()=>anchor};
  const target={closest:selector=>selector.startsWith('[data-forwardable')?anchor:null};
  const gestures=installMessageGestures(root,{enabled:()=>enabled,openMenu:id=>opened.push(id),setTimer:fn=>{timers.set(++counter,fn);return counter;},clearTimer:id=>timers.delete(id),now:()=>100});
  const event=(extra={})=>({target,isPrimary:true,button:0,pointerId:1,clientX:20,clientY:20,...extra});
  const emit=(name,extra)=>handlers.get(name)?.(event(extra));
  const fire=()=>{const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());};
  return {gestures,opened,handlers,timers,target,anchor,emit,fire,disable:()=>{enabled=false;}};
}

test('long press opens one stable message and suppresses only its compatibility click',()=>{
  const f=fixture();f.emit('pointerdown');f.fire();assert.deepEqual(f.opened,['original']);
  let prevented=0,stopped=0;f.emit('click',{preventDefault:()=>prevented++,stopImmediatePropagation:()=>stopped++});
  assert.equal(prevented,1);assert.equal(stopped,1);
  f.emit('click',{preventDefault:()=>prevented++,stopImmediatePropagation:()=>stopped++});assert.equal(prevented,1);
  f.gestures.dispose();assert.equal(f.handlers.size,0);
});

test('touch release cannot click a newly inserted dialog backdrop, while the next intentional tap works',()=>{
  const f=fixture();f.emit('pointerdown');f.fire();assert.deepEqual(f.opened,['original']);
  const backdrop={closest:()=>null};f.emit('pointerup',{target:backdrop});
  let prevented=0;f.emit('click',{target:backdrop,detail:1,preventDefault:()=>prevented++,stopImmediatePropagation:()=>{}});
  assert.equal(prevented,1);
  f.emit('pointerdown');f.fire();f.emit('pointerup',{target:backdrop});
  f.emit('pointerdown',{target:backdrop});f.emit('pointerup',{target:backdrop});
  f.emit('click',{target:backdrop,detail:1,preventDefault:()=>prevented++,stopImmediatePropagation:()=>{}});
  assert.equal(prevented,1);f.gestures.dispose();
});

test('short tap, movement, scroll, cancellation, removed anchors and disabled views do not open a menu',()=>{
  for(const stop of [f=>f.emit('pointerup'),f=>f.emit('pointermove',{clientX:32}),f=>f.emit('scroll'),f=>f.emit('pointercancel'),f=>{f.anchor.isConnected=false;},f=>f.disable()]){
    const f=fixture();f.emit('pointerdown');stop(f);f.fire();assert.deepEqual(f.opened,[]);f.gestures.dispose();
  }
});

test('buttons and secondary pointers keep their native behavior',()=>{
  const f=fixture();f.emit('pointerdown',{target:{closest:s=>s.startsWith('[data-forwardable')?f.anchor:{}}});f.fire();
  f.emit('pointerdown',{isPrimary:false});f.fire();f.emit('pointerdown',{button:2});f.fire();assert.deepEqual(f.opened,[]);f.gestures.dispose();
});

test('read cursor follows viewport order including a partially visible long message',()=>{
  const node=(id,top,bottom)=>({dataset:{messageId:id},getBoundingClientRect:()=>({top,bottom})});
  const timeline={getBoundingClientRect:()=>({top:100,bottom:700}),querySelectorAll:()=>[node('above',-400,99),node('visible',110,180),node('long',200,3000),node('unseen',3001,3100)]};
  assert.equal(lastVisibleMessage(timeline,800),'long');assert.equal(lastVisibleMessage(timeline,100),null);
  assert.equal(lastVisibleMessage(null,800),null);assert.equal(lastVisibleMessage(timeline,0),null);
});
