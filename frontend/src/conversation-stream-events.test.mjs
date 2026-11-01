import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('./App.vue',import.meta.url),'utf8');
const functions=['executionEventLabel','executionEventDetail','executionEventSummary','executionEventRows'].map(name=>{
 const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');
const rows=new Function(`${functions};return executionEventRows;`)();

test('body snapshots do not repeat as generic CLI output stages while actual tools and public summaries remain',()=>{
 const events=[{id:'body',type:'action.response',data:{channel:'assistant',text:'真实正文',sequence:1}},{id:'tool',type:'action.stage',data:{stage:'tool',detail:'读取资料'}},{id:'summary',type:'action.stage',data:{stage:'reasoning',summary:'公开摘要'}}];
 const result=rows(events);assert.deepEqual(result.map(row=>row.id),['tool','summary']);assert.equal(result[0].detail,'读取资料');assert.equal(result[1].summary,'公开摘要');
});
