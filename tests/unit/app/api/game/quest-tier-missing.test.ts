/**
 * GET /api/game/quest — an HSK tier that holds no chars at all.
 *
 * 2026-11-03: the production server answered 404 `level_not_found` for
 * HSK 1 level 1, and the client told the learner "这一关不存在 —— 它可能
 * 已经随着字库更新而移走了". Both were wrong.
 *
 * The real cause was that `chars.hsk_level` had never been filled on that
 * server — `scripts/import-hsk.ts` is a deployment script, not a migration,
 * so nothing runs it automatically. With every `hsk_level` NULL, the tier's
 * query returns zero rows, the tier is empty, and every level of it is
 * "beyond the tier's level count".
 *
 * A missing tier and a missing level are different problems with different
 * fixes, so the route must answer them differently:
 *
 *   - a missing tier  → 503 `hsk_level_not_imported` + the command that
 *     fixes it (the server is fine, its data is not ready);
 *   - a missing level → 404 `level_not_found` (that level will not come
 *     back for this process, but the tier is healthy).
 *
 * The handler is called directly — no server is started. The data layer is
 * mocked, so the test needs no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/game-quest-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/game-quest-data')>();
  return { ...actual, getQuestTier: vi.fn() };
});

import { getQuestTier } from '@/lib/game-quest-data';
import { buildTier } from '@/lib/game-quest';
import type { QuestCharFact, QuestTier } from '@/lib/game-quest-types';
import { HSK_LEVELS_NOT_IMPORTED } from '@/lib/game-quest-types';
import { GET } from '@/app/api/game/quest/route';

/**
 * Ten eligible chars with distinct syllables, radicals and meaning clauses,
 * so every distractor pool has enough candidates. The builder slices the
 * eligible pool into levels of FIVE, so fewer than five chars would produce
 * no level at all — the fixture has to be big enough for one.
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
];

/** A healthy tier, built by the real builder. */
const TIER: QuestTier = buildTier(1, FACTS);

/** The tier of a server whose HSK grading was never imported. */
const EMPTY_TIER: QuestTier = buildTier(1, []);

function makeReq(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/game/quest${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getQuestTier).mockResolvedValue(TIER);
});

describe('GET /api/game/quest — a tier that was never imported', () => {
  it('answers 503 with the code that names the cause', async () => {
    vi.mocked(getQuestTier).mockResolvedValue(EMPTY_TIER);
    const res = await GET(makeReq('?hsk=1&level=1'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(HSK_LEVELS_NOT_IMPORTED);
  });

  it('puts the command that fixes it into the message', async () => {
    vi.mocked(getQuestTier).mockResolvedValue(EMPTY_TIER);
    const res = await GET(makeReq('?hsk=1&level=1'));
    const body = await res.json();
    // The reader of this message is an operator. "The tier is empty" alone
    // is not actionable; the command is.
    expect(body.error.message).toContain('import-hsk.ts');
  });

  it('does NOT answer 404 — the tier and the level are different problems', async () => {
    vi.mocked(getQuestTier).mockResolvedValue(EMPTY_TIER);
    const res = await GET(makeReq('?hsk=1&level=1'));
    expect(res.status).not.toBe(404);
  });

  it('keeps the error uncached, like every other answer of this route', async () => {
    vi.mocked(getQuestTier).mockResolvedValue(EMPTY_TIER);
    const res = await GET(makeReq('?hsk=1&level=1'));
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('still answers 404 for a level beyond a HEALTHY tier', async () => {
    // The tier has 10 eligible chars but the pool is too small for a second
    // level, so level 2 does not exist — and that is the other failure.
    const res = await GET(makeReq('?hsk=1&level=99'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('level_not_found');
  });

  it('still answers 200 for a level of a HEALTHY tier', async () => {
    const res = await GET(makeReq('?hsk=1&level=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
