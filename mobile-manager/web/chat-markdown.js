// A text-first subset for chat. Raw HTML stays text; images use the attachment viewer.
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function inline(value) {
  const fragments = [];
  const keep = html => `\u0000${fragments.push(html)-1}\u0000`;
  const restore = text => text.replace(/\u0000(\d+)\u0000/g, (_, index) => fragments[Number(index)]);
  let text = String(value).replace(/\u0000/g, '');
  text = text.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escape(code)}</code>`));
  text = text.replace(/(!?)\[([^\]\n]+)\]\(([^\s)]+)\)/g, (original, image, label, href) => {
    if (image || !/^(https?:\/\/|mailto:)/i.test(href)) return original;
    return keep(`<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${restore(escape(label))}</a>`);
  });
  text = escape(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return restore(text);
}
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
const tableRule = line => line?.includes('|') && cells(line).every(cell => /^:?-{3,}:?$/.test(cell));

export function renderMarkdown(value) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n'), output = [];
  let paragraph = [], list = null, quote = [], code = null;
  const flushParagraph = () => { if (paragraph.length) { output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = []; } };
  const flushList = () => { if (list) { output.push(`<${list.kind}>${list.rows.map(row => `<li>${inline(row)}</li>`).join('')}</${list.kind}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { output.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); quote = []; } };
  const flush = () => { flushParagraph(); flushList(); flushQuote(); };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (code) {
      if (fence && fence[1][0] === code.fence[0] && fence[1].length >= code.fence.length && !fence[2].trim()) {
        output.push(`<pre><code>${escape(code.lines.join('\n'))}</code></pre>`); code = null;
      } else code.lines.push(line);
      continue;
    }
    if (fence) { flush(); code = {fence:fence[1],lines:[]}; continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flush(); output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (line.includes('|') && tableRule(lines[index + 1])) {
      flush(); const head = cells(line), rows = []; index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) rows.push(cells(lines[index++]));
      index--;
      output.push(`<div class="markdown-table" tabindex="0" role="region" aria-label="表格，左右滑动查看"><table><thead><tr>${head.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${head.map((_, col) => `<td>${inline(row[col] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flush(); output.push('<hr>'); continue; }
    const item = /^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph(); flushQuote(); const kind = item[1] ? 'ul' : 'ol';
      if (list?.kind !== kind) { flushList(); list = {kind, rows:[]}; }
      list.rows.push(item[2]); continue;
    }
    if (/^>\s?/.test(line)) { flushParagraph(); flushList(); quote.push(line.replace(/^>\s?/, '')); continue; }
    flushList(); flushQuote(); paragraph.push(line);
  }
  flush();
  if (code) output.push(`<pre><code>${escape(code.lines.join('\n'))}</code></pre>`);
  return output.join('');
}
