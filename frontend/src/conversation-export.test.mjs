import test from 'node:test';
import assert from 'node:assert/strict';

const exporter=await import('./conversation-export.js').catch(()=>({}));
test('Markdown export contains only loaded messages with their original times and attachment names',()=>{
  assert.equal(typeof exporter.loadedConversationMarkdown,'function');
  const conversation={id:'chat-one',title:'研究 / 计划',messagePage:{hasMore:true,total:200},messages:[{role:'user',content:'第一条',created_at:'2026-10-30T01:00:00Z',attachments:[{name:'产品[封面].png'}]},{role:'assistant',content:'**结论**\n\n- 下一步',created_at:'2026-10-30T01:00:02Z'}]};
  const exported=exporter.loadedConversationMarkdown(conversation,{employeeName:'社群主理人',exportedAt:'2026-10-30T02:00:00Z'});
  assert.match(exported.filename,/\.md$/);assert.doesNotMatch(exported.filename,/[\\/:*?"<>|]/);
  for(const text of ['已加载的 2 条消息','不代表全部历史','社群主理人','2026-10-30T01:00:00Z','2026-10-30T01:00:02Z','产品\\[封面\\].png','**结论**','- 下一步'])assert.ok(exported.content.includes(text),text);
  assert.doesNotMatch(exported.content,/200 条|全部 200/);
});

test('already loaded forwarded records retain their source timestamps and attachment names',()=>{
  const forward={schemaVersion:1,id:'forward-one',mode:'reference',source:{conversationId:'source',employeeName:'原员工'},messages:[{sourceMessageId:'source-message',role:'assistant',createdAt:'2026-10-29T00:00:00Z',content:'原记录',attachments:[{name:'原图.png'}]}]};
  const result=exporter.loadedConversationMarkdown({id:'current',messages:[{role:'user',forward}]});
  assert.match(result.content,/原员工/);assert.match(result.content,/2026-10-29T00:00:00Z/);assert.match(result.content,/原图.png/);assert.match(result.content,/已加载的 1 条消息/);
});
