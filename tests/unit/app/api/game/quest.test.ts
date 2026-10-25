/**
 * GET /api/game/quest?hsk=N&level=M
 *
 * The handler is called directly — no server is started (the convention of
 * tests/unit/app/api/ai/char-recognize.test.ts). The data layer is mocked,
 * so the test exercises the route's contract: the query validation, the
 * 404 for a level beyond the tier, and the shape of the payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// 'server-only' throws outside a React Server Component graph. The data layer
// (and lib/content.ts behind it) is marked server-only, so the marker is
// neutralized for the test process.
vi.mock('server-only', () => ({}));

// The real module is kept (its resolveQuestReading is under test) and only
// the data access is replaced.
vi.mock('@/lib/game-quest-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/game-quest-data')>();
  return { ...actual, getQuestTier: vi.fn() };
});

import { getQuestTier, resolveQuestReading } from '@/lib/game-quest-data';
import { buildTier } from '@/lib/game-quest';
import type { QuestCharFact, QuestTier } from '@/lib/game-quest-types';
import { GET } from '@/app/api/game/quest/route';

/**
 * A hand-built tier: 10 eligible chars with distinct syllables, radicals and
 * meaning clauses (so every distractor pool has enough candidates) plus one
 * ineligible char (视 — its first free clause is the 1-character 看, which
 * cannot be a ④ option).
 *
 * The tier is built by the real builder, so the levels the route returns are
 * the ones the production code produces.
 */
const FACTS: QuestCharFact[] = [
  {
    char: '爱',
    reading: 'ài',
    radical: '爪',
    meaningZh: '对人或万物怀有深厚真挚的情谊',
    pinyinAlt: ['ài'],
    hasStory: true,
  },
  {
    char: '八',
    reading: 'bā',
    radical: '八',
    meaningZh: '数目字七加一所得的整数',
    pinyinAlt: ['bā'],
    hasStory: true,
  },
  {
    char: '杯',
    reading: 'bēi',
    radical: '木',
    meaningZh: '盛放茶汁的圆形小器皿',
    pinyinAlt: ['bēi'],
    hasStory: true,
  },
  {
    char: '大',
    reading: 'dà',
    radical: '大',
    meaningZh: '体积规模超过一般的事物',
    pinyinAlt: ['dà', 'dài'],
    hasStory: true,
  },
  {
    char: '火',
    reading: 'huǒ',
    radical: '火',
    meaningZh: '燃烧时向外散发光与热',
    pinyinAlt: ['huǒ'],
    hasStory: true,
  },
  {
    char: '家',
    reading: 'jiā',
    radical: '宀',
    meaningZh: '共同生活在一起的亲属',
    pinyinAlt: ['jiā'],
    hasStory: true,
  },
  {
    char: '白',
    reading: 'bái',
    radical: '白',
    meaningZh: '一种纯净无杂的颜色',
    pinyinAlt: ['bái'],
    hasStory: true,
  },
  {
    char: '口',
    reading: 'kǒu',
    radical: '口',
    meaningZh: '嘴巴与吞咽食物的器官',
    pinyinAlt: ['kǒu'],
    hasStory: false,
  },
  {
    char: '山',
    reading: 'shān',
    radical: '山',
    meaningZh: '地面上隆起的高大地形',
    pinyinAlt: ['shān'],
    hasStory: true,
  },
  {
    char: '水',
    reading: 'shuǐ',
    radical: '水',
    meaningZh: '无色无味可以饮用之液体',
    pinyinAlt: ['shuǐ'],
    hasStory: true,
  },
  {
    char: '视',
    reading: 'shì',
    radical: '示',
    meaningZh: '看 观察 用目光审视事物',
    pinyinAlt: ['shì'],
    hasStory: true,
  },
];

const TIER: QuestTier = buildTier(1, FACTS);

function makeReq(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/game/quest${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getQuestTier).mockResolvedValue(TIER);
});

describe('GET /api/game/quest', () => {
  it('returns the level payload', async () => {
    const res = await GET(makeReq('?hsk=1&level=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.hsk).toBe(1);
    expect(body.data.level).toBe(1);
    expect(body.data.levelCount).toBe(2);
    expect(body.data.tierSize).toBe(TIER.tierSize);
    expect(body.data.skipped).toBe(TIER.skipped);
    expect(body.data.chars).toHaveLength(5);
  });

  it('every char carries four questions of four options', async () => {
    const res = await GET(makeReq('?hsk=1&level=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.chars).toHaveLength(5);
    for (const char of body.data.chars) {
      expect(char.questions).toHaveLength(4);
      expect(char.questions.map((q: { kind: string }) => q.kind)).toEqual([
        'pinyin',
        'tone',
        'radical',
        'meaning',
      ]);
      for (const question of char.questions) {
        expect(question.options).toHaveLength(4);
        expect(question.answerIndex).toBeGreaterThanOrEqual(0);
        expect(question.answerIndex).toBeLessThanOrEqual(3);
      }
    }
  });

  it('is not cached by the browser', async () => {
    const res = await GET(makeReq('?hsk=1&level=1'));
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects an out-of-range tier with 400 bad_input', async () => {
    const res = await GET(makeReq('?hsk=9&level=1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('bad_input');
    expect(getQuestTier).not.toHaveBeenCalled();
    // The errors are not cacheable either — a 400 means the query itself was
    // malformed, and re-issuing it unchanged will keep failing.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a level below 1 with 400', async () => {
    const res = await GET(makeReq('?hsk=1&level=0'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('bad_input');
  });

  it('rejects a missing level with 400', async () => {
    const res = await GET(makeReq('?hsk=1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('bad_input');
  });

  it('answers 404 level_not_found for a level beyond the tier', async () => {
    const res = await GET(makeReq('?hsk=1&level=999'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('level_not_found');
    // A 404 is not permanent: the tier is built once per server process, so
    // the eligible pool grows when the content files are regenerated and the
    // server restarts - a browser must not cache it.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 500 when the data layer fails', async () => {
    vi.mocked(getQuestTier).mockRejectedValue(new Error('db is down'));
    const res = await GET(makeReq('?hsk=1&level=1'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('server');
    // The 500 is not cacheable either - every response of this route carries
    // `no-store`, the errors included.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('resolveQuestReading', () => {
  it('falls back to pinyin-pro when the DB column is empty', () => {
    expect(resolveQuestReading('爱', null)).toBe('ài');
    expect(resolveQuestReading('爱', '')).toBe('ài');
  });

  it("keeps a DB reading that is one of the char's tone forms", () => {
    expect(resolveQuestReading('长', 'cháng')).toBe('cháng');
  });

  it('keeps only the first segment of a multi-reading value', () => {
    expect(resolveQuestReading('行', 'xíng,háng')).toBe('xíng');
  });

  it('falls back to pinyin-pro when the reading is not a tone form', () => {
    // 长's tone forms are chāng cháng chǎng chàng — 'zhǎng' is not among
    // them, so the reading falls back to pinyin-pro's default (cháng).
    expect(resolveQuestReading('长', 'zhǎng')).toBe('cháng');
  });

  it('spells a j/q/x/y ü syllable the standard way', () => {
    // The ② options are toneFormsOf(char) — 学 → xuē xué xuě xuè — so the
    // reading has to be the 'u' spelling too.
    expect(resolveQuestReading('学', null)).toBe('xué');
    expect(resolveQuestReading('去', null)).toBe('qù');
  });
});
