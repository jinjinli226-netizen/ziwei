import test from 'node:test';
import assert from 'node:assert/strict';
import {captureChatScroll,restoreChatScroll,distanceFromEnd} from '../web/chat-scroll.js';

function timeline({top=0, height=1000, viewport=300, messages=[]}={}) {
  const node = {scrollTop:top,scrollHeight:height,clientHeight:viewport,getBoundingClientRect:()=>({top:80}),querySelectorAll:()=>messages.map(message=>({dataset:{messageId:message.id},getBoundingClientRect:()=>({top:80+message.top-node.scrollTop,bottom:80+message.top+message.height-node.scrollTop})}))};
  return node;
}

test('only follows updates at a distance of at most 40 pixels', () => {
  for (const [distance, expected] of [[0,true],[40,true],[41,false],[120,false],[121,false]]) {
    const node = timeline({top:700-distance});
    assert.equal(distanceFromEnd(node), distance);
    assert.equal(captureChatScroll(node).following, expected);
  }
});

test('keeps the same visible message after older messages are prepended and new ones append', () => {
  const messages = [{id:'one',top:0,height:200},{id:'two',top:200,height:200},{id:'three',top:400,height:200}];
  const node = timeline({top:220,messages}), saved = captureChatScroll(node);
  assert.equal(saved.anchor.id, 'two'); assert.equal(saved.anchor.offset, -20);
  messages.forEach(message=>message.top+=150); node.scrollHeight+=300;
  restoreChatScroll(node,saved,true);
  assert.equal(node.scrollTop,370);
});

test('follows at the end and opens new conversations at the newest message', () => {
  const node = timeline({top:680}), saved = captureChatScroll(node);
  node.scrollHeight+=100; restoreChatScroll(node,saved,true); assert.equal(node.scrollTop,1100);
  node.scrollTop=0; restoreChatScroll(node,{top:200,following:false},false); assert.equal(node.scrollTop,1100);
});

test('retains top when an old anchor is absent and tolerates screens without a timeline', () => {
  const node = timeline({top:220}); restoreChatScroll(node,{top:150,following:false,anchor:{id:'gone',offset:0}},true); assert.equal(node.scrollTop,150);
  assert.equal(captureChatScroll(null),null); restoreChatScroll(null,null,false);
});
