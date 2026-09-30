// Small allow-list HTML sanitizer for task descriptions. The UI renders rich
// descriptions, so anything that can execute script or load active content is
// dropped on the server instead of trusting every client.
const ALLOWED_TAGS = new Set(['a','b','strong','i','em','u','s','del','p','br','hr','span','div','ul','ol','li','h1','h2','h3','h4','h5','h6','code','pre','blockquote','img','table','thead','tbody','tr','th','td','sub','sup','mark','details','summary']);
const DROP_WITH_CONTENT = /^(script|style|iframe|object|embed|noscript|template|svg|math|form|textarea|title|head|meta|link|base)$/i;
const ALLOWED_ATTRS = { a:['href','title','target','rel'], img:['src','alt','title','width','height'], td:['colspan','rowspan'], th:['colspan','rowspan'], '*':['title','class'] };
const TAG = /<(\/?)([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const decodeEntities = value => String(value)
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d) || 32))
  .replace(/&(colon|tab|newline);?/gi, (_, n) => ({ colon: ':', tab: ' ', newline: ' ' })[n.toLowerCase()]);

function safeUrl(value, { image = false } = {}) {
  const compact = decodeEntities(value).replace(/[\u0000- \u007f-\u009f]+/g, '').toLowerCase();
  if (compact.startsWith('//')) return false;
  if (/^(https?:|mailto:|tel:)/.test(compact)) return true;
  if (!/^[a-z][a-z0-9+.-]*:/.test(compact)) return true; // relative, #anchor or /path
  return image && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/.test(compact);
}
const escapeText = text => text.replace(/</g, '&lt;');
const escapeAttr = value => String(value).replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function sanitizeHtml(input) {
  const source = String(input ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  let out = ''; let last = 0; let skipUntil = null; let match;
  TAG.lastIndex = 0;
  while ((match = TAG.exec(source))) {
    const [, closing, nameRaw, attrText] = match; const name = nameRaw.toLowerCase();
    if (skipUntil) { if (closing && name === skipUntil) { skipUntil = null; last = TAG.lastIndex; } continue; }
    out += escapeText(source.slice(last, match.index)); last = TAG.lastIndex;
    if (DROP_WITH_CONTENT.test(name)) { if (!closing && !/\/\s*$/.test(attrText)) skipUntil = name; continue; }
    if (!ALLOWED_TAGS.has(name)) continue;
    if (closing) { out += `</${name}>`; continue; }
    const allowed = new Set([...(ALLOWED_ATTRS[name] || []), ...ALLOWED_ATTRS['*']]); let attrs = ''; let attr;
    ATTR.lastIndex = 0;
    while ((attr = ATTR.exec(attrText))) {
      const key = attr[1].toLowerCase(); const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
      if (!allowed.has(key) || key.startsWith('on')) continue;
      if ((key === 'href' || key === 'src') && !safeUrl(value, { image: name === 'img' })) continue;
      attrs += ` ${key}="${escapeAttr(value)}"`;
    }
    if (name === 'a') attrs += ' rel="noopener noreferrer"';
    out += `<${name}${attrs}>`;
  }
  if (!skipUntil) out += escapeText(source.slice(last));
  return out;
}
