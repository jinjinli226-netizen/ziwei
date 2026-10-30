// Adapted from DSH ui/markdown.js (D:/dshbot), 2026-10-30.
// Text-first Markdown: all input is escaped and links use a strict scheme allowlist.
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function inline(value) {
  let text = escapeHtml(value).replace(/\u0000/g, ""),
    fragments = [];
  const restore = (text) => text.replace(/\u0000(\d+)\u0000/g, (_, index) => fragments[Number(index)] || "");
  const keep = (html) => { fragments.push(html); return "\u0000" + (fragments.length - 1) + "\u0000"; };
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    return keep("<code>" + code + "</code>");
  });
  text = text.replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (_, label, raw) => {
    const href = raw.replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href))
      return label + " (" + raw + ")";
    // Keep generated anchors out of subsequent emphasis replacements, including their href.
    return keep(
      '<a href="' +
      escapeHtml(href) +
      '" target="_blank" rel="noopener noreferrer">' +
      restore(label) +
      "</a>"
    );
  });
  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return restore(text);
}
export function markdown(value) {
  const lines = String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n"),
    out = [];
  let paragraph = [],
    code = null,
    list = null,
    quote = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push("<p>" + paragraph.map(inline).join("<br>") + "</p>");
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(
        "<" +
          list.kind +
          ">" +
          list.rows.map((row) => "<li>" + inline(row) + "</li>").join("") +
          "</" +
          list.kind +
          ">",
      );
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(
        "<blockquote>" + quote.map(inline).join("<br>") + "</blockquote>",
      );
      quote = [];
    }
  };
  const flush = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      if (code) {
        out.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      out.push(
        "<h" +
          heading[1].length +
          ">" +
          inline(heading[2]) +
          "</h" +
          heading[1].length +
          ">",
      );
      continue;
    }
    const item = /^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      flushQuote();
      const kind = item[1] ? "ul" : "ol";
      if (list?.kind !== kind) {
        flushList();
        list = { kind, rows: [] };
      }
      list.rows.push(item[2]);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || "")) {
      flush();
      const cells = (s) =>
        s
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((x) => x.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(cells(lines[i]));
        i++;
      }
      i--;
      out.push(
        "<table><thead><tr>" +
          head.map((x) => "<th>" + inline(x) + "</th>").join("") +
          "</tr></thead><tbody>" +
          rows
            .map(
              (row) =>
                "<tr>" +
                row.map((x) => "<td>" + inline(x) + "</td>").join("") +
                "</tr>",
            )
            .join("") +
          "</tbody></table>",
      );
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line);
  }
  flush();
  if (code)
    out.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
  return out.join("");
}
