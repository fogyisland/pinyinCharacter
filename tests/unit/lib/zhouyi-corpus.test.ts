/**
 * The 周易 volumes are fetched from wikisource by scripts/build-classics-zhouyi.ts,
 * which needs network access. These tests guard the committed artifacts instead
 * of re-fetching: a bad regeneration must not silently corrupt the corpus.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ZhouyiChunk {
  id: number;
  label: string;
  content: string[];
  pinyin: string[][];
}

interface ZhouyiVolume {
  slug: string;
  title: string;
  category: string;
  source: string;
  bookTitle: string;
  chapterRange: { from: number; to: number };
  chunks: ZhouyiChunk[];
}

function readVolume(slug: string): ZhouyiVolume {
  const path = join(process.cwd(), 'data', 'classics', `${slug}.json.gz`);
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as ZhouyiVolume;
}

const UPPER_HEXAGRAMS = ['乾卦', '坤卦', '屯卦', '蒙卦', '需卦', '讼卦', '师卦', '比卦', '小畜卦', '履卦'];
const LOWER_HEXAGRAMS = ['咸卦', '恒卦', '遯卦', '大壮卦', '晋卦', '明夷卦'];
const YIZHUAN = ['系辞上传', '系辞下传', '说卦传', '序卦传', '杂卦传'];

describe('周易 corpus', () => {
  it('covers 30 上经 hexagrams, 34 下经 hexagrams and the five 十翼 chapters', () => {
    const upper = readVolume('zhouyi-shangjing');
    const lower = readVolume('zhouyi-xiajing');
    const yizhuan = readVolume('zhouyi-yizhuan');

    expect(upper.chunks).toHaveLength(30);
    expect(lower.chunks).toHaveLength(34);
    expect(yizhuan.chunks).toHaveLength(5);
    expect(upper.chunks.slice(0, 10).map((chunk) => chunk.label)).toEqual(UPPER_HEXAGRAMS);
    expect(lower.chunks.slice(0, 6).map((chunk) => chunk.label)).toEqual(LOWER_HEXAGRAMS);
    expect(yizhuan.chunks.map((chunk) => chunk.label)).toEqual(YIZHUAN);
    for (const volume of [upper, lower, yizhuan]) {
      expect(volume.category).toBe('five-classics');
      expect(volume.source).toMatch(/^zh\.wikisource\.org/);
      expect(volume.bookTitle).toBe('周易');
      expect(volume.chapterRange).toEqual({ from: 1, to: volume.chunks.length });
    }
  });

  it('keeps 乾 as 乾 (OpenCC would otherwise emit 干) and converts the rest to 简体', () => {
    const upper = readVolume('zhouyi-shangjing');
    const qian = upper.chunks[0]!;
    expect(qian.label).toBe('乾卦');
    // 文言 legitimately uses 干 for 幹 (事之干也 / 干事), so scope this to the 经文 lines.
    const opening = qian.content.slice(0, 10).join('\n');
    expect(opening).toContain('乾：元亨。利贞。');
    expect(opening).not.toContain('干');
    expect(opening).toContain('潜龙勿用');
    expect(readVolume('zhouyi-yizhuan').chunks[0]!.content.join('\n')).toContain('天尊地卑');
  });

  it('aligns every pinyin row with its content line and keeps chunk ids one-based', () => {
    for (const slug of ['zhouyi-shangjing', 'zhouyi-xiajing', 'zhouyi-yizhuan']) {
      const volume = readVolume(slug);
      volume.chunks.forEach((chunk, index) => {
        expect(chunk.id).toBe(index + 1);
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.pinyin).toHaveLength(chunk.content.length);
        chunk.content.forEach((line, lineIndex) => {
          expect(chunk.pinyin[lineIndex]).toHaveLength(Array.from(line).length);
        });
      });
    }
  });

  it('is registered in the manifest so /ancient lists all three volumes', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'data', 'classics-manifest.json'), 'utf8'),
    ) as { books: Array<{ slug: string; category: string; chapterCount: number }> };
    const slugs = ['zhouyi-shangjing', 'zhouyi-xiajing', 'zhouyi-yizhuan'];
    for (const slug of slugs) {
      const entry = manifest.books.find((book) => book.slug === slug);
      expect(entry).toBeDefined();
      expect(entry!.category).toBe('five-classics');
      expect(entry!.chapterCount).toBe(readVolume(slug).chunks.length);
    }
  });
});
