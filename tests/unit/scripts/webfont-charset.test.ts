import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isCjkChar,
  stripSourceComments,
  scoreCharacters,
  planTiers,
  unicodeRange,
  unionOfPages,
  loadFamilyCharsets,
} from '../../../scripts/fonts/webfont-charset.mjs';

describe('isCjkChar', () => {
  it('accepts CJK ideographs and CJK punctuation', () => {
    expect(isCjkChar('一')).toBe(true);   // U+4E00
    expect(isCjkChar('、')).toBe(true);   // U+3001
    expect(isCjkChar('！')).toBe(true);   // U+FF01
    expect(isCjkChar('永')).toBe(true);   // U+6C38
  });

  it('rejects latin, digits, punctuation and accented letters', () => {
    for (const ch of ['a', '1', ' ', '·', 'é', '—', '“']) {
      expect(isCjkChar(ch)).toBe(false);
    }
  });
});

describe('stripSourceComments', () => {
  it('drops a line comment but keeps the string next to it', () => {
    expect(stripSourceComments('const a = "字"; // 注释里的字\n')).toContain('字');
    expect(stripSourceComments('const a = "字"; // 注释里的字\n')).not.toContain('注');
  });

  it('drops a block comment but keeps the code around it', () => {
    expect(stripSourceComments('/* 块注释 */const b = 1;')).toBe('const b = 1;');
  });

  it('keeps a comment marker inside a string', () => {
    expect(stripSourceComments('const url = "https://example.com";')).toContain('https://example.com');
  });

  it('keeps an escaped quote inside a string', () => {
    expect(stripSourceComments('const a = "字\\" // 字"; // 注\n')).toContain('// 字');
    expect(stripSourceComments('const a = "字\\" // 字"; // 注\n')).not.toContain('注');
  });

  it('keeps a template literal and its backticks', () => {
    expect(stripSourceComments('const a = `字 // 字`; // 注\n')).toContain('`字 // 字`');
    expect(stripSourceComments('const a = `字 // 字`; // 注\n')).not.toContain('注');
  });

  it('keeps the Chinese characters that follow a URL in a JSX text', () => {
    // components/admin/SiteUrlForm.tsx:95 paints this text. A hand written
    // stripper read the `//` of the URL as the start of a line comment and
    // dropped everything behind it — with it ten characters the page really
    // draws, which then fell out of the charset entirely.
    const source = [
      "          {initial.source === 'unset' && (",
      '            <p className="text-sm text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">',
      '              尚未设置站点 URL。当前 sitemap、robots、canonical、JSON-LD 都会退回到',
      '              http://localhost:3000, 外部爬虫会看到错误的域名。',
      '            </p>',
      '          )}',
      '',
    ].join('\n');
    const stripped = stripSourceComments(source, 'SiteUrlForm.tsx');
    expect(stripped).toContain('http://localhost:3000');
    expect(stripped).toContain('外部爬虫会看到错误的域名。');
    expect(stripped).toContain('尚未设置站点 URL。');
  });

  it('does not let a regexp literal swallow the code behind it', () => {
    // lib/ai-rare-chars.ts:162 — the quotes of a regexp are not the quotes
    // of a string. A hand written stripper believed they were: it stayed
    // in the string state and dropped the comments of the lines behind it,
    // so their characters took the thousandfold source weight.
    const source = [
      '  const kvRe = /"(\\w+)"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"/g;',
      '  let m: RegExpExecArray | null;',
      '  while ((m = kvRe.exec(stripped)) !== null) {',
      '    if (!(m[1] in kv)) kv[m[1]] = m[2];',
      '  }',
      '  // 注释里的字',
      '  return kv;',
      '',
    ].join('\n');
    const stripped = stripSourceComments(source, 'ai-rare-chars.ts');
    expect(stripped).not.toContain('注');
    expect(stripped).toContain('const kvRe =');
    expect(stripped).toContain('kvRe.exec(stripped)');
    expect(stripped).toContain('return kv;');
  });

  it('strips a comment inside a JSX container', () => {
    const source = [
      'const node = (',
      '  <div>',
      '    {/* 容器里的注释 */}',
      '    <span>字</span>',
      '  </div>',
      ');',
      '',
    ].join('\n');
    const stripped = stripSourceComments(source, 'Commented.tsx');
    expect(stripped).not.toContain('注');
    expect(stripped).toContain('<span>字</span>');
  });

  it('keeps the characters of a comment out of the source scan', () => {
    // The contract the source scan depends on: a character that lives only
    // in a comment is never painted, so it must not earn the thousandfold
    // source weight and take a slot of the hot tier.
    const source = 'const label = "字";\n// 注释里的字\nconst other = "文";\n';
    const stripped = stripSourceComments(source, 'label.ts');
    expect(stripped).not.toContain('注');
    expect(stripped).toContain('字');
    expect(stripped).toContain('文');
  });

  it('parses a .ts file as TypeScript, so a type assertion does not hide the comments behind it', () => {
    // `<string>raw` is a type assertion in TypeScript and JSX in TSX. A TSX
    // parser loses track of the file there, so the file name has to pick
    // the ScriptKind — which is why `scanSourceDirectory` passes the real
    // name of every file it reads.
    const source = 'const value = <string>raw;\n// 注释里的字\nlet x = 1;\n';
    expect(stripSourceComments(source, 'value.ts')).not.toContain('注');
    expect(stripSourceComments(source, 'value.ts')).toContain('let x = 1;');
    expect(stripSourceComments(source, 'value.tsx')).toContain('注');
  });
});

describe('unionOfPages', () => {
  /** The code point of a character — the order assertions are about code points. */
  const codePointOf = (ch: string): number => ch.codePointAt(0) ?? Number.NaN;

  it('orders the seed by the number of pages that painted a character, then by code point', () => {
    // F27-j-c: the seed is ordered by how many pages painted a character,
    // and the ties are broken by ascending code point.
    const seed = unionOfPages(
      { p1: { serif: '甲乙' }, p2: { serif: '乙丙' } },
      'serif',
    );
    expect(seed).toHaveLength(3);
    // 乙 is painted by two pages, so it leads.
    expect(seed[0]).toBe('乙');
    // The two singletons are ordered by CODE POINT, not by stroke order:
    // 丙 is U+4E19 and 甲 is U+7532.
    expect(codePointOf(seed[1])).toBe(0x4e19);
    expect(codePointOf(seed[2])).toBe(0x7532);
    expect(codePointOf(seed[1])).toBeLessThan(codePointOf(seed[2]));
  });

  it('keeps only Chinese characters', () => {
    // A hot tier slot is scarce: an ASCII letter or a space that slipped
    // into the fixture must not take one of them.
    const seed = unionOfPages(
      { p1: { serif: '甲a' }, p2: { serif: '丙 ' } },
      'serif',
    );
    expect(seed).toHaveLength(2);
    expect(seed).not.toContain('a');
    expect(seed).not.toContain(' ');
    expect(codePointOf(seed[0])).toBe(0x4e19);
    expect(codePointOf(seed[1])).toBe(0x7532);
  });
});

describe('scoreCharacters', () => {
  it('adds the weighted occurrences of every source', () => {
    const scored = scoreCharacters([
      { id: 'corpus', weight: 1, chars: ['永', '永', '永'] },
      { id: 'src', weight: 1000, chars: ['永'] },
    ]);
    expect(scored.score.get('永')).toBe(1003);
  });

  it('orders by descending score, then by ascending code point', () => {
    const scored = scoreCharacters([
      { id: 'corpus', weight: 1, chars: ['永', '一'] },
      { id: 'src', weight: 1000, chars: ['丁'] },
    ]);
    expect(scored.ordered[0]).toBe('丁');
    expect(scored.ordered.slice(1).sort()).toEqual(['一', '永']);
  });

  it('keeps only CJK characters', () => {
    const scored = scoreCharacters([{ id: 'x', weight: 1, chars: ['a', '永'] }]);
    expect(scored.ordered).toEqual(['永']);
  });
});

describe('planTiers', () => {
  const chars = ['一', '丁', '丂', '七', '万', '丈']; // U+4E00..U+4E05
  const scored = scoreCharacters([
    { id: 'x', weight: 1, chars: chars.slice().reverse() },
  ]);
  const big = scoreCharacters([
    { id: 'x', weight: 1, chars: Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i)) },
  ]);

  it('puts the hottest characters in the hot tier', () => {
    const plan = planTiers(scored, { tier1Size: 2 });
    expect(plan.hot).toHaveLength(2);
  });

  it('cuts the tail into blocks of a fixed CHARACTER count', () => {
    // The tail after a 2 character hot tier is 丂, 七, 万, 丈. The blocks
    // hold two characters each, so the tail falls into two blocks — not
    // into the three blocks a 2 code point window would produce (the old
    // mechanism split it as 丂七 / 万 / 丈).
    const plan = planTiers(scored, { tier1Size: 2, extBlockChars: 2 });
    expect(plan.extBlocks).toHaveLength(2);
    expect(plan.extBlocks[0].chars).toEqual(['丂', '七']);
    expect(plan.extBlocks[1].chars).toEqual(['万', '丈']);
  });

  it('keeps the ext blocks in score order, not code point order', () => {
    // 七 scores a thousand times more than 一 and 丈, so the frequency
    // order is 七 / 一 / 丈 even though 一 has the lower code point.
    // A code point ordered mechanism would have produced 一 / 七 / 丈.
    const mixed = scoreCharacters([
      { id: 'x', weight: 1, chars: ['一', '丈'] },
      { id: 'src', weight: 1000, chars: ['七'] },
    ]);
    const plan = planTiers(mixed, { tier1Size: 0, extBlockChars: 3 });
    expect(plan.extBlocks).toHaveLength(1);
    expect(plan.extBlocks[0].chars).toEqual(['七', '一', '丈']);
  });

  it('numbers the ext blocks from 1, contiguously', () => {
    const plan = planTiers(scored, { tier1Size: 2, extBlockChars: 2 });
    expect(plan.extBlocks.map((b) => b.index)).toEqual([1, 2]);
  });

  it('puts every character in exactly one tier', () => {
    const plan = planTiers(scored, { tier1Size: 2, extBlockChars: 2 });
    const all = [...plan.hot, ...plan.extBlocks.flatMap((b) => b.chars)];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...chars].sort());
  });

  it('fills every block but the last with exactly the block size', () => {
    const plan = planTiers(big, { tier1Size: 300, extBlockChars: 6 });
    expect(plan.extBlocks).toHaveLength(Math.ceil((2000 - 300) / 6));
    expect(plan.extBlocks.slice(0, -1).every((b) => b.chars.length === 6)).toBe(true);
  });

  it('defaults to a 300 character hot tier and 6 characters per ext block', () => {
    const plan = planTiers(big);
    expect(plan.hot).toHaveLength(300);
    expect(plan.extBlocks).toHaveLength(Math.ceil((2000 - 300) / 6));
  });

  it('never produces an empty ext block', () => {
    const plan = planTiers(big, { tier1Size: 300, extBlockChars: 6 });
    expect(plan.extBlocks.every((b) => b.chars.length > 0)).toBe(true);
  });

  it('never repeats a character between the hot tier and an ext block', () => {
    const plan = planTiers(big, { tier1Size: 300, extBlockChars: 6 });
    const hot = new Set(plan.hot);
    expect(plan.extBlocks.some((b) => b.chars.some((c) => hot.has(c)))).toBe(false);
  });

  it('rejects a non positive block size', () => {
    expect(() => planTiers(scored, { extBlockChars: 0 })).toThrow();
  });

  it('never truncates the seeded characters, even when they exceed the tier size', () => {
    // A painted character that falls out of the hot tier is a tofu box
    // (G10), so the tier grows instead of dropping names.
    const seeded = ['永', '和', '谐'];
    const plan = planTiers(scored, { tier1Size: 2, hotChars: seeded });
    expect(plan.hot.slice(0, 3)).toEqual(seeded);
    expect(plan.hot).toHaveLength(3);
  });

  it('keeps the seeded characters first and fills the rest by frequency', () => {
    const plan = planTiers(scored, { tier1Size: 3, hotChars: ['丁'] });
    expect(plan.hot[0]).toBe('丁');
    expect(plan.hot).toHaveLength(3);
    expect(new Set(plan.hot).size).toBe(3);
  });

  it('places a seeded character that the corpus does not contain in the hot tier', () => {
    // The page profile may name a character the corpus missed (F27-j-e
    // found seven of them in the poem titles). It still has to get a glyph.
    const plan = planTiers(scored, { tier1Size: 1, hotChars: ['鵩'] });
    expect(plan.hot[0]).toBe('鵩');
  });

  it('puts the seeded characters at the head of the hot tier, in seed order', () => {
    // The seed is the head of the hot tier and it keeps its OWN order — the
    // page count order — not the corpus frequency order.
    const seed = unionOfPages(
      { p1: { serif: '甲乙' }, p2: { serif: '乙丙' } },
      'serif',
    );
    const plan = planTiers(scored, { tier1Size: 10, hotChars: seed });
    expect(plan.hot.slice(0, seed.length)).toEqual(seed);
  });

  it('treats the tier size as a floor: a seed longer than the tier grows the hot tier', () => {
    // `tier1Size` is a floor, not a cap. A painted character that fell out
    // of the hot tier would have no glyph in it (G10).
    const seeded = ['一', '二', '三', '四', '五'];
    const plan = planTiers(scored, { tier1Size: 2, hotChars: seeded });
    expect(plan.hot.slice(0, 5)).toEqual(seeded);
    expect(plan.hot.length).toBeGreaterThanOrEqual(5);
  });
});

describe('unicodeRange', () => {
  it('merges consecutive code points into one range', () => {
    expect(unicodeRange(['一', '丁'])).toBe('U+4E00-4E01');
  });

  it('keeps a gap as two ranges', () => {
    expect(unicodeRange(['一', '七'])).toBe('U+4E00, U+4E03');
  });

  it('emits a bare code point for a single character', () => {
    expect(unicodeRange(['一'])).toBe('U+4E00');
  });

  it('returns an empty string for no characters', () => {
    expect(unicodeRange([])).toBe('');
  });
});

describe('loadFamilyCharsets', () => {
  const charsetOf = (plan: { hot: string[]; extBlocks: { chars: string[] }[] }) =>
    new Set([...plan.hot, ...plan.extBlocks.flatMap((b) => b.chars)]);

  it(
    'builds nested charsets: wenkai ⊂ sans ⊂ serif',
    () => {
      const plans = loadFamilyCharsets();
      const size = (p: { hot: string[]; extBlocks: { chars: string[] }[] }) =>
        p.hot.length + p.extBlocks.flatMap((b) => b.chars).length;
      expect(size(plans.wenkai)).toBeGreaterThan(0);
      expect(size(plans.wenkai)).toBeLessThan(size(plans.sans));
      expect(size(plans.sans)).toBeLessThanOrEqual(size(plans.serif));
    },
    180_000,
  );

  it('uses the per family hot tier sizes from the rulings', () => {
    const plans = loadFamilyCharsets();
    expect(plans.sans.hot).toHaveLength(300);
    expect(plans.serif.hot).toHaveLength(300);
    // R14 said "no hot tier for the brand face"; F27-j-d reversed that —
    // without a brand face hot tier /poetry opens 120 files.
    expect(plans.wenkai.hot).toHaveLength(300);
  }, 180_000);

  it('seeds the hot tier with the characters the measured pages paint', () => {
    // F27-j-c: the hot tier holds a FIXED number of characters, so WHICH
    // characters it holds is free. The page profile fixture is the only
    // evidence of what the pages actually paint.
    const plans = loadFamilyCharsets();
    const fixture = JSON.parse(
      readFileSync(
        resolve(fileURLToPath(new URL('../../../data/font-page-profiles.json', import.meta.url))),
        'utf8',
      ),
    ) as { pages: Record<string, Record<string, string>> };
    for (const family of ['sans', 'serif', 'wenkai'] as const) {
      const painted = new Set<string>();
      for (const page of Object.values(fixture.pages)) {
        for (const ch of page[family] ?? '') painted.add(ch);
      }
      expect(painted.size).toBeGreaterThan(0);
      const hot = new Set(plans[family].hot);
      const missing = [...painted].filter((ch) => !hot.has(ch));
      expect(missing).toEqual([]);
    }
  }, 180_000);

  it('covers every poem title character in wenkai, because the poem card paints them in the brand face', () => {
    // F27-j-e: components/poetry/PoemCard.tsx renders 《诗题》 in
    // font-kai. Seven of the title characters existed in NO other corpus
    // source, so they were falling back to the system font today.
    const plans = loadFamilyCharsets();
    const wenkai = new Set(
      [...plans.wenkai.hot, ...plans.wenkai.extBlocks.flatMap((b) => b.chars)],
    );
    for (const ch of ['鵩', '飚', '巂', '岧', '鴈', '劒', '濬']) {
      expect(wenkai.has(ch)).toBe(true);
    }
  }, 180_000);

  it('covers the UI literals and the corpus characters', () => {
    const plans = loadFamilyCharsets();
    const sans = new Set(
      [...plans.sans.hot, ...plans.sans.extBlocks.flatMap((b) => b.chars)],
    );
    for (const ch of ['字', '韵', '一', '永', '故', '唐']) {
      expect(sans.has(ch)).toBe(true);
    }
  }, 180_000);

  it('covers the rare characters in wenkai and in sans', () => {
    const plans = loadFamilyCharsets();
    const wenkai = charsetOf(plans.wenkai);
    const sans = charsetOf(plans.sans);
    // 㑇 and 㕮 are rare characters: data/content/<char>.json holds a
    // `rare` object for them, and the story page renders the character
    // itself in font-kai, so the brand face has to carry them.
    for (const ch of ['㑇', '㕮']) {
      expect(wenkai.has(ch)).toBe(true);
      expect(sans.has(ch)).toBe(true);
    }
  }, 180_000);

  it('puts every dictionary radical in the wenkai charset', () => {
    const plans = loadFamilyCharsets();
    const wenkai = charsetOf(plans.wenkai);
    const sans = charsetOf(plans.sans);
    const serif = charsetOf(plans.serif);
    // 戶 and 韭 are the two radicals the source literals miss — the
    // dictionary spells 戶 as the simplified 户 and omits 韭 entirely.
    expect(wenkai.has('戶')).toBe(true);
    expect(wenkai.has('韭')).toBe(true);
    for (const ch of wenkai) expect(sans.has(ch)).toBe(true);
    for (const ch of sans) expect(serif.has(ch)).toBe(true);
  }, 180_000);

  it('covers every standard character in wenkai, because the chain game paints them in the brand face', () => {
    const plans = loadFamilyCharsets();
    const wenkai = charsetOf(plans.wenkai);
    const standard = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../data/general-standard-chinese-characters.json', import.meta.url)),
        'utf8',
      ),
    ) as string[];
    expect(standard.length).toBeGreaterThan(0);
    expect(standard.filter((ch) => !wenkai.has(ch))).toEqual([]);
  }, 180_000);

  it('keeps the wenkai charset inside the measured bounds', () => {
    const plans = loadFamilyCharsets();
    const size = plans.wenkai.hot.length + plans.wenkai.extBlocks.flatMap((b) => b.chars).length;
    // The lower bound is the 8 105 standard characters of R16; the upper
    // bound catches an accidental scan of the 70 234 KEYS of
    // data/radicals.json, which are a lookup table that is never rendered.
    expect(size).toBeGreaterThanOrEqual(8105);
    expect(size).toBeLessThan(9000);
  }, 180_000);

  it('honours a per family override even after the default plans were cached', () => {
    loadFamilyCharsets();
    const plans = loadFamilyCharsets({ families: { sans: { tier1Size: 10 } } });
    // `tier1Size` is a FLOOR: the seeded union of the measured pages is
    // longer than 10, so the hot tier holds the union and stops there. The
    // default's 300 characters are gone — a cache that ignored the
    // override would hand back the 300 character default plan.
    expect(plans.sans.hot.length).toBeLessThan(300);
    expect(plans.sans.hot.length).toBeGreaterThanOrEqual(10);
  }, 180_000);

  it('treats an explicitly undefined override as no override', () => {
    // A spread of the override object over the defaults lets an explicit
    // `undefined` win the spread and wipe the default out. The observable
    // invariant is the one that matters: such a call has to produce exactly
    // the default plan, hot tier and Ext blocks alike.
    const defaults = loadFamilyCharsets();
    const plans = loadFamilyCharsets({ families: { wenkai: { tier1Size: undefined } } });
    expect(plans.wenkai.hot).toEqual(defaults.wenkai.hot);
    expect(plans.wenkai.extBlocks).toHaveLength(defaults.wenkai.extBlocks.length);
  }, 180_000);

  it('lets a caller override the page profile seed of one family', () => {
    const plans = loadFamilyCharsets({ families: { sans: { hotChars: ['鵩'] } } });
    expect(plans.sans.hot[0]).toBe('鵩');
    expect(plans.sans.hot).toHaveLength(300);
  }, 180_000);

  it('fails loudly when the page profile fixture cannot be read', () => {
    // A silent fallback to the corpus frequency order would put the hot
    // tier back to the hit rate this module exists to fix.
    expect(() =>
      loadFamilyCharsets({ pageProfiles: 'no/such/font-page-profiles.json' }),
    ).toThrow(/font-page-profiles|page profile/i);
  }, 180_000);
});
