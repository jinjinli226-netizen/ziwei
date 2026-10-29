import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeConversationLatest,prependConversationHistory,isConversationNearBottom,shouldShowConversationLatest,shouldLoadEarlierHistory,restoreConversationPrependScroll} from './conversation-history.mjs';
const message=(id,minute,content=id)=>({id,created_at:`2026-10-21T01:${String(minute).padStart(2,'0')}:00.000Z`,content});
const conversation=(messages,page={},extra={})=>({id:'chat-a',messages,messagePage:{hasMore:true,beforeCursor:messages[0]?.id||null,total:100,...page},...extra});

test('refresh updates overlapping messages while keeping loaded history and a just-sent message',()=>{
  const current=conversation([message('old',1),message('overlap',2),message('just-sent',4)],{beforeCursor:'old'});
  const latest=conversation([message('overlap',2,'updated answer'),message('incoming',3)],{beforeCursor:'overlap',total:101},{status:'current'});
  const merged=mergeConversationLatest(current,latest);
  assert.deepEqual(merged.messages.map(row=>row.id),['old','overlap','incoming','just-sent']);
  assert.equal(merged.messages[1].content,'updated answer');assert.equal(merged.messagePage.beforeCursor,'old');assert.equal(merged.messagePage.total,101);assert.equal(merged.status,'current');
  assert.equal(current.messages[1].content,'overlap');assert.equal(current.messages.length,3);
});

test('unpaged full detail keeps its existing replacement contract',()=>{
  const current=conversation([message('old',1)]),full={id:'chat-a',messages:[],execution:{id:'current'}};
  assert.equal(mergeConversationLatest(current,full),full);assert.deepEqual(mergeConversationLatest(current,full).messages,[]);
});

test('a fully loaded history stays complete when new messages make the latest page bounded again',()=>{
  const current=conversation([message('old',1),message('last',2)],{hasMore:false});
  const latest=conversation([message('last',2),message('new',3)],{hasMore:true});
  assert.equal(mergeConversationLatest(current,latest).messagePage.hasMore,false);
});

test('loading older history prepends unique messages without reverting current metadata or content',()=>{
  const current=conversation([message('overlap',2,'fresh content'),message('current',3)],{total:104},{execution:{id:'new-action'},employee:{id:'employee-current'},working_directory:'D:/work'});
  const older=conversation([message('oldest',1),message('overlap',2,'old content')],{hasMore:false,total:100},{execution:{id:'stale-action'},employee:{id:'other'},working_directory:'C:/stale'});
  const merged=prependConversationHistory(current,older);
  assert.deepEqual(merged.messages.map(row=>row.id),['oldest','overlap','current']);assert.equal(merged.messages[1].content,'fresh content');
  assert.equal(merged.messagePage.hasMore,false);assert.equal(merged.messagePage.beforeCursor,'oldest');assert.equal(merged.messagePage.total,104);
  assert.equal(merged.execution,current.execution);assert.equal(merged.employee,current.employee);assert.equal(merged.working_directory,'D:/work');assert.equal(current.messages.length,2);
});

test('empty older pages finish pagination, and foreign histories cannot change the current conversation',()=>{
  const current=conversation([message('last',2)]),empty=conversation([],{hasMore:false,beforeCursor:null});
  assert.equal(prependConversationHistory(current,empty).messagePage.hasMore,false);
  assert.equal(prependConversationHistory(current,{...empty,id:'chat-other'}),current);
  assert.equal(mergeConversationLatest(current,{...empty,id:'chat-other'}).id,'chat-other');
});

test('initial, programmatic, downward and failed scroll states never automatically load every history page',()=>{
  const base={hasMore:true,scrollTop:50,previousScrollTop:200,userInitiated:true};
  assert.equal(shouldLoadEarlierHistory(base),true);
  for(const patch of [{userInitiated:false},{loading:true},{error:'network error'},{hasMore:false},{scrollTop:210},{scrollTop:170}])assert.equal(shouldLoadEarlierHistory({...base,...patch}),false);
  assert.equal(shouldLoadEarlierHistory({hasMore:true,scrollTop:0,previousScrollTop:0,userInitiated:true}),false);
});

test('prepending keeps the same viewport anchor and following new messages depends on proximity to bottom',()=>{
  assert.equal(restoreConversationPrependScroll({scrollTop:75,scrollHeight:1000,nextScrollHeight:1600}),675);
  assert.equal(restoreConversationPrependScroll({scrollTop:75,anchorOffset:-10,nextAnchorOffset:590,nextScrollHeight:1800}),675);
  assert.equal(restoreConversationPrependScroll({scrollTop:75,anchorOffset:100,nextAnchorOffset:10}),0);
  // A later image above the retained anchor grows by 200px after the first
  // restoration. Apply that delta to the current viewport, not its old offset.
  assert.equal(restoreConversationPrependScroll({scrollTop:675,anchorOffset:-10,nextAnchorOffset:190}),875);
  assert.equal(isConversationNearBottom({scrollHeight:1000,scrollTop:500,clientHeight:400}),false);
  assert.equal(isConversationNearBottom({scrollHeight:1000,scrollTop:100,clientHeight:400}),false);
});

test('following includes the 40px boundary and jumping appears only beyond 120px',()=>{
  const viewport=distance=>({scrollHeight:1000,scrollTop:600-distance,clientHeight:400});
  for(const distance of [0,39,40])assert.equal(isConversationNearBottom(viewport(distance)),true);
  for(const distance of [41,120,121])assert.equal(isConversationNearBottom(viewport(distance)),false);
  for(const distance of [0,40,120])assert.equal(shouldShowConversationLatest(viewport(distance)),false);
  assert.equal(shouldShowConversationLatest(viewport(121)),true);
});
