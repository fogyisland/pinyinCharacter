/**
 * Minimal Markdown → HTML renderer for the /guide page.
 *
 * Supports: ATX headings (# / ## / ###), paragraphs, ordered/unordered lists,
 * fenced code blocks (```), GFM tables, **bold**, *italic*, `inline code`,
 * and [text](url) links.
 *
 * Output is HTML. The caller is responsible for injecting it via
 * dangerouslySetInnerHTML into a sanitized container (we escape HTML
 * special chars first, so the only 'danger' is links, which we want to keep).
 * For richer markdown needs, swap this for `marked` or `react-markdown`.
 */

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text: string): string {
  // Order matters: code spans first (don't apply other formatting inside).
  // Match `...` non-greedy.
  let out = '';
  let i = 0;
  while (i < text.length) {
    const codeStart = text.indexOf('`', i);
    if (codeStart === -1) {
      out += renderInlineNoCode(text.slice(i));
      break;
    }
    out += renderInlineNoCode(text.slice(i, codeStart));
    const codeEnd = text.indexOf('`', codeStart + 1);
    if (codeEnd === -1) {
      out += renderInlineNoCode(text.slice(codeStart));
      break;
    }
    const code = text.slice(codeStart + 1, codeEnd);
    out += `<code class="rounded bg-paper-deep px-1 py-0.5 text-[0.85em]">${escapeHtml(code)}</code>`;
    i = codeEnd + 1;
  }
  return out;
}

function renderInlineNoCode(s: string): string {
  let out = escapeHtml(s);
  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    // External URLs get target=_blank rel=noopener; relative links stay internal.
    const isExternal = /^https?:\/\//i.test(url);
    const safeUrl = url.replace(/"/g, '&quot;');
    const safeText = String(text);
    if (isExternal) {
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-seal hover:underline">${safeText}</a>`;
    }
    return `<a href="${safeUrl}" class="text-seal hover:underline">${safeText}</a>`;
  });
  // Bold: **text** (must come before italic so we don't trip over it)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* (single asterisks; allow leading/trailing space)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'heading': {
      const sizes: Record<number, string> = {
        1: 'text-3xl font-bold mt-8 mb-4',
        2: 'text-2xl font-semibold mt-7 mb-3',
        3: 'text-xl font-semibold mt-5 mb-2',
        4: 'text-base font-semibold mt-4 mb-2',
        5: 'text-sm font-semibold mt-3 mb-1',
        6: 'text-xs font-semibold mt-3 mb-1',
      };
      return `<h${block.level} class="${sizes[block.level]} text-ink">${renderInline(block.text)}</h${block.level}>`;
    }
    case 'paragraph':
      return `<p class="text-ink-soft leading-relaxed my-3">${renderInline(block.text)}</p>`;
    case 'code': {
      const lang = block.lang ? ` data-lang="${escapeHtml(block.lang)}"` : '';
      return `<pre class="rounded-md bg-paper-deep p-3 my-4 overflow-x-auto text-xs leading-relaxed"${lang}><code>${escapeHtml(block.text)}</code></pre>`;
    }
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const cls = block.ordered
        ? 'list-decimal list-inside space-y-1 my-3 text-ink-soft'
        : 'list-disc list-inside space-y-1 my-3 text-ink-soft';
      const items = block.items.map((it) => `<li>${renderInline(it)}</li>`).join('');
      return `<${tag} class="${cls}">${items}</${tag}>`;
    }
    case 'table': {
      const headerCells = block.headers.map((h) => `<th class="px-2 py-1.5 text-left font-semibold text-ink">${renderInline(h)}</th>`).join('');
      const bodyRows = block.rows.map((row) => {
        const cells = row.map((c) => `<td class="px-2 py-1.5 text-ink-soft align-top">${renderInline(c)}</td>`).join('');
        return `<tr class="border-t border-paper-warm">${cells}</tr>`;
      }).join('');
      return `<div class="overflow-x-auto my-4"><table class="w-full text-sm border border-paper-warm rounded-md">
        <thead class="bg-paper-deep"><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table></div>`;
    }
  }
}

function parseTableRow(line: string): string[] {
  // Trim leading/trailing pipes then split.
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  // | --- | :---: | ---: |
  const cells = parseTableRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines (they just separate blocks).
    if (line.trim() === '') { i++; continue; }

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? '';
      const start = i + 1;
      let end = start;
      while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
      blocks.push({ kind: 'code', lang, text: lines.slice(start, end).join('\n') });
      i = end + 1;
      continue;
    }

    // ATX heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      blocks.push({
        kind: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // Table: header row, separator row, then data rows.
    if (/^\|/.test(line.trim()) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && /^\|/.test(lines[j].trim()) && !isTableSeparator(lines[j])) {
        rows.push(parseTableRow(lines[j]));
        j++;
      }
      blocks.push({ kind: 'table', headers, rows });
      i = j;
      continue;
    }

    // Ordered list: 1. 2. ...
    const olMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (olMatch) {
      const items: string[] = [olMatch[2]];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].match(/^\d+\.\s+(.+)/);
        if (!next) break;
        items.push(next[1]);
        j++;
      }
      blocks.push({ kind: 'list', ordered: true, items });
      i = j;
      continue;
    }

    // Unordered list: - foo  / * foo
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    if (ulMatch) {
      const items: string[] = [ulMatch[1]];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].match(/^[-*]\s+(.+)/);
        if (!next) break;
        items.push(next[1]);
        j++;
      }
      blocks.push({ kind: 'list', ordered: false, items });
      i = j;
      continue;
    }

    // Default: paragraph (collect lines until blank line or block-start).
    const buf: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (next.trim() === '') break;
      if (/^#{1,6}\s/.test(next)) break;
      if (/^```/.test(next)) break;
      if (/^[-*]\s+/.test(next)) break;
      if (/^\d+\.\s+/.test(next)) break;
      if (/^\|/.test(next.trim())) break;
      buf.push(next);
      j++;
    }
    blocks.push({ kind: 'paragraph', text: buf.join(' ') });
    i = j;
  }

  return blocks.map(renderBlock).join('\n');
}