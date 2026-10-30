import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const renderer=await import('./chat-markdown.js').catch(()=>({}));

test('the actual assistant renderer supports escaped code, tables, lists and links',()=>{
  assert.equal(typeof renderer.markdown,'function');
  const html=renderer.markdown('# 结果\n\n- 一\n- 二\n\n|项目|状态|\n|---|---|\n|检查|通过|\n\n```js\nconst x = "<script>";\n```\n\n[文档](https://example.test/docs?a=1&b=2)');
  for(const fragment of ['<h1>结果</h1>','<ul><li>一</li><li>二</li></ul>','<table>','<th>项目</th>','<td>通过</td>','&lt;script&gt;','href="https://example.test/docs?a=1&amp;b=2"','rel="noopener noreferrer"'])assert.ok(html.includes(fragment),fragment);
});

test('link destinations are isolated from emphasis and inline-code replacements',()=>{
  assert.equal(renderer.markdown('[文档](https://example.test/**docs**)'),'<p><a href="https://example.test/**docs**" target="_blank" rel="noopener noreferrer">文档</a></p>');
  assert.match(renderer.markdown('[`名称`](https://example.test/)'),/<a [^>]+><code>名称<\/code><\/a>/);
});

test('the real renderer escapes raw HTML, quote payloads and disallowed link schemes',()=>{
  const attacks=['<img src=x onerror=alert(1)>','<svg onload=alert(1)>','[危险](javascript:alert(1))','[危险](data:text/html,<script>alert(1)</script>)','[危险](vbscript:msgbox(1))','[危险](//example.test/)','[引号](https://example.test/"onmouseover="alert(1))','[实体](https://example.test/&#34;onclick=alert(1))'];
  for(const attack of attacks){
    const html=renderer.markdown(attack);
    assert.doesNotMatch(html,/<(?:img|svg|script|iframe|object)\b/i,attack);
    assert.doesNotMatch(html,/<a href="(?:javascript:|data:|vbscript:|\/\/)/i,attack);
    assert.doesNotMatch(html,/<a [^>]*"\s+on\w+=/i,attack);
  }
});

test('Edge parses renderer attack output without executable tags, attributes or URL schemes',{skip:process.platform!=='win32',timeout:25000},async t=>{
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  try{await fs.access(edge);}catch{t.skip('Microsoft Edge is not installed');return;}
  const profile=fileURLToPath(new URL('../../.local/markdown-security-edge-'+process.pid,import.meta.url));
  await fs.mkdir(profile,{recursive:true});
  const browser=spawn(edge,['--headless=new','--remote-debugging-pipe','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--disable-features=msImplicitSignin','--no-proxy-server','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
  let sequence=0,buffer='',closed=false;const pending=new Map();
  browser.stdio[4].on('data',chunk=>{
    buffer+=chunk;let boundary;
    while((boundary=buffer.indexOf('\0'))>=0){
      const message=JSON.parse(buffer.slice(0,boundary));buffer=buffer.slice(boundary+1);const request=pending.get(message.id);
      if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error(message.error.message)):request.resolve(message.result);}
    }
  });
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('DevTools pipe timeout: '+method));},15000);
    pending.set(id,{resolve,reject,timer});browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
  });
  try{
    const {targetId}=await call('Target.createTarget',{url:'about:blank'}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    const attacks=['<img src=x onerror=alert(1)>','<svg onload=alert(1)>','[x](javascript:alert(1))','[x](data:text/html,<script>alert(1)</script>)','[x](https://example.test/"onmouseover="alert(1))','[x](https://example.test/&#34;onclick=alert(1))','[x](https://example.test/**docs**)','**[x](https://example.test/)**','[`<img onerror=x>`](https://example.test/)','[x](https://example.test/`onclick`)','[x](java\u0000script:alert(1))'];
    const output=attacks.map(renderer.markdown),expression=`(()=>{const violations=[];for(const [index,html] of ${JSON.stringify(output)}.entries()){const root=document.createElement('div');root.innerHTML=html;for(const element of root.querySelectorAll('*')){if(!['P','A','STRONG','EM','DEL','CODE'].includes(element.tagName))violations.push(index+':tag:'+element.tagName);for(const attribute of element.attributes)if(element.tagName!=='A'||!['href','target','rel'].includes(attribute.name))violations.push(index+':attribute:'+attribute.name);if(element.tagName==='A'&&!['http:','https:','mailto:'].includes(element.protocol))violations.push(index+':scheme:'+element.protocol);}}return violations;})()`;
    const result=await call('Runtime.evaluate',{expression,returnByValue:true},sessionId);
    assert.equal(result.exceptionDetails,undefined);assert.deepEqual(result.result.value,[]);
    await call('Browser.close');closed=true;
  }finally{
    for(const request of pending.values())clearTimeout(request.timer);
    if(!closed){const cleanup=spawn('taskkill.exe',['/PID',String(browser.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(resolve=>cleanup.once('close',resolve));}
  }
});
