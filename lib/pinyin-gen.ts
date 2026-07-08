/**
 * Build-time pinyin generation helpers.
 *
 * These functions are call-site for offline/CLI Sutra importers (and any
 * other content that needs char-level pinyin with tone marks). They use
 * `pinyin-pro` which produces results like 'xīn' for '心'.
 *
 * This module is server-only / build-time — never imported from client
 * components (it would pull pinyin-pro into a client bundle).
 *
 * `toBmp` filters chars that mysql2's binary protocol mangles on the way
 * into MySQL JSON columns (see memory/mysql2-supp-plane-bug.md). Apply at
 * write time so every downstream reader gets clean text.
 */
import { pinyin } from 'pinyin-pro';

export interface RawChunk {
  label: string;
  content: string[];
}

export function charPinyin(ch: string): string {
  if (!ch.trim()) return '';
  try {
    const result = pinyin(ch, { toneType: 'symbol', type: 'array' });
    if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'string') {
      return result[0]!;
    }
  } catch {
    // fall through
  }
  return '';
}

export function linePinyin(line: string): string[] {
  return Array.from(line).map(charPinyin);
}

export function withPinyinBatch(chunks: RawChunk[]) {
  const content = chunks.map((c) => c.content.map(toBmp));
  return chunks.map((c, i) => ({
    label: c.label,
    content: content[i],
    pinyin: content[i].map(linePinyin),
  }));
}

export function toBmp(s: string): string {
  return Array.from(s)
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      if (ch.length > 1) return false;             // 4-byte UTF-8 (surrogate pair)
      if (code >= 0xD800 && code <= 0xDFFF) return false; // surrogate half
      if (code === 0xFFFD) return false;                  // replacement char
      return true;
    })
    .join('');
}
