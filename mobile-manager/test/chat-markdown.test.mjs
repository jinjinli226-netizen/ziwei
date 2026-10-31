import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from '../web/chat-markdown.js';

test('renders readable headings, emphasis, lists, quotes and line breaks', () => {
  const html = renderMarkdown('# 工作进度\n\n**已经完成**，*可以检查*，~~旧结论~~\n第二行\n\n- 第一项\n- 第二项\n\n1. 打开文件\n2. 查看结果\n\n> 公开摘要\n\n---');
  for (const value of ['<h1>工作进度</h1>', '<strong>已经完成</strong>', '<em>可以检查</em>', '<del>旧结论</del>', '<br>第二行', '<ul><li>第一项</li><li>第二项</li></ul>', '<ol><li>打开文件</li><li>查看结果</li></ol>', '<blockquote>公开摘要</blockquote>', '<hr>']) assert.ok(html.includes(value), value);
});

test('keeps code literal, including an unfinished streaming fence', () => {
  assert.equal(renderMarkdown('`<b>**原文**</b>`'), '<p><code>&lt;b&gt;**原文**&lt;/b&gt;</code></p>');
  assert.equal(renderMarkdown('```js\nconst x = "<script>";\n**原样**'), '<pre><code>const x = &quot;&lt;script&gt;&quot;;\n**原样**</code></pre>');
  assert.equal(renderMarkdown('~~~~\n```\n~~~~\n完成'), '<pre><code>```</code></pre><p>完成</p>');
});

test('renders table values as escaped text in a horizontally scrollable region', () => {
  const html = renderMarkdown('| 项目 | 结果 |\n| :--- | ---: |\n| A | **通过** |\n| B | <img src=x> |');
  assert.match(html, /class="markdown-table" tabindex="0"/);
  assert.match(html, /<th>项目<\/th><th>结果<\/th>/);
  assert.match(html, /<td>A<\/td><td><strong>通过<\/strong><\/td>/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img/);
});

test('allows only explicit web and email links and never imports remote images', () => {
  const html = renderMarkdown('[说明](https://example.com/a?b=1&c=2) [邮箱](mailto:hello@example.com)\n[危险](javascript:alert) [文件](file:///a) [相对](//example.com) ![外图](https://example.com/a.png)');
  assert.match(html, /href="https:\/\/example.com\/a\?b=1&amp;c=2"/);
  assert.match(html, /href="mailto:hello@example.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.equal((html.match(/<a /g) || []).length, 2);
  assert.doesNotMatch(html, /<img|href="(?:javascript|file|\/\/)/);
});

test('escapes raw HTML, attributes and placeholder-like input without emitting executable tags', () => {
  const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>\n[x](https://example.com/"onclick="alert)\n\u00000\u0000');
  assert.doesNotMatch(html, /<script|<img| href="[^"]*"onclick=/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;onclick=&quot;alert/);
  assert.doesNotMatch(html, /\u0000|undefined/);
});

test('inline code in a link label remains text and code', () => {
  assert.match(renderMarkdown('[查看 `main.js`](https://example.com)'), /<a [^>]+>查看 <code>main.js<\/code><\/a>/);
});
