// Safe markdown-lite renderer for assistant text. ALWAYS escapes first (model/document text is untrusted).
// Latin runs (SR paths, menu labels, IDs, IPs, codes) are isolated with <bdi dir="ltr"> so Arabic RTL never scrambles them.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const RUN = /&(?:amp|lt|gt|quot|#39);|[A-Za-z0-9](?:[A-Za-z0-9 _.:\/→\-]|&amp;)*[A-Za-z0-9]|[A-Za-z0-9]/g;

export function inline(raw) {
  let s = esc(String(raw).replace(/\s>\s/g, ' → '));
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return String.fromCharCode(0xE000 + codes.length - 1); });
  s = s.replace(RUN, m => (m.startsWith('&') ? m : `<bdi dir="ltr">${m}</bdi>`));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/[-]/g, ch => `<code dir="ltr">${codes[ch.charCodeAt(0) - 0xE000] ?? ''}</code>`);
  return s;
}

// First "A → B → C" span in a raw line (for the copy-path button).
export function extractPath(line) {
  const m = String(line).replace(/\s>\s/g, ' → ').match(/[A-Za-z0-9][^→\n]*(?:→[^→\n]+)+/);
  return m ? m[0].replace(/\*\*/g, '').trim() : null;
}

export function renderMarkdown(text) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null, code = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (/^```/.test(line)) {
      if (code) { out.push(`<div class="codeblock"><button class="mini" data-copy-text="${esc(code.join('\n'))}">نسخ</button><pre dir="ltr">${esc(code.join('\n'))}</pre></div>`); code = null; }
      else { closeList(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${lineHtml(ul ? ul[1] : ol[1])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    out.push(h ? `<h4>${inline(h[1])}</h4>` : `<p>${lineHtml(line)}</p>`);
  }
  if (code) out.push(`<pre dir="ltr">${esc(code.join('\n'))}</pre>`);
  closeList();
  return out.join('');
}

function lineHtml(raw) {
  const path = extractPath(raw);
  const html = inline(raw);
  return path ? `${html} <button class="mini" data-copy-text="${esc(path)}" title="نسخ المسار">نسخ المسار</button>` : html;
}
