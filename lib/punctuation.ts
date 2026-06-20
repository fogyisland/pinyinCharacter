export const SENT_END: ReadonlySet<string> = new Set(['。', '！', '？']);

const PUNCT: ReadonlySet<string> = new Set([
  '。', '，', '！', '？', '；', '：', '、',
  '“', '”', '‘', '’',
  '「', '」', '（', '）', '(', ')', '…', '—',
]);

export function isPunct(ch: string): boolean {
  if (!ch) return false;
  return PUNCT.has(ch);
}

export function stripPunct(s: string): string {
  return Array.from(s).filter(ch => !isPunct(ch)).join('');
}

/**
 * Returns cell indices where a separator should be inserted BEFORE that cell.
 * A cell at index N gets a separator if the original string had a sentence-end
 * punctuation (`。！？`) immediately before the non-punct char that produced
 * cell N.
 *
 * Example: '学而时习之。不亦说乎。' (10 chars total, 8 non-punct)
 *   non-punct chars: 学(0) 而(1) 时(2) 习(3) 之(4) 不(5) 亦(6) 说(7) 乎(8)
 *   breakpoint set: { 5 }  (before "不")
 */
export function buildBreakpoints(chunk: { content: string[] }): Set<number> {
  const set = new Set<number>();
  const chars = chunk.content.flatMap(line => Array.from(line));
  let cellIdx = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (isPunct(ch)) continue;
    const prev = i > 0 ? chars[i - 1]! : '';
    if (SENT_END.has(prev)) set.add(cellIdx);
    cellIdx++;
  }
  return set;
}