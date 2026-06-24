import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { InitCharsPanel } from '@/components/admin/InitCharsPanel';
import { GenerateCharsForm } from '@/components/admin/GenerateCharsForm';
import { CharContentSchema } from '@/scripts/schemas/content';
import { readPreservedStats } from './preserved-stats';

export const dynamic = 'force-dynamic';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');

/**
 * Read content coverage from data/content/<char>.json files.
 * Single source of truth for all LLM-generated content (post-migration).
 * Falls back gracefully when the dir is empty.
 */
function readContentCoverage() {
  if (!existsSync(CONTENT_DIR)) {
    return { zh: 0, en: 0, alt: 0, var: 0, etymology: 0, hanzi: 0, rareMeaning: 0, rareStory: 0 };
  }
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json'));
  let zh = 0, en = 0, alt = 0, variants = 0, etymology = 0, hanzi = 0, rareMeaning = 0, rareStory = 0;
  for (const f of files) {
    try {
      const raw = JSON.parse(require('node:fs').readFileSync(join(CONTENT_DIR, f), 'utf8'));
      const c = CharContentSchema.parse(raw);
      if (c.dict?.meaning_zh || c.meaning_zh) zh++;
      if (c.dict?.meaning_en) en++;
      if (c.dict?.pinyin_alt) alt++;
      if (c.dict?.variants) variants++;
      if (c.etymology?.story || c.etymology_story) etymology++;
      if (c.hanzi_story) hanzi++;
      if (c.rare?.meaning) rareMeaning++;
      if (c.rare?.story) rareStory++;
    } catch {
      // skip malformed
    }
  }
  return { zh, en, alt, var: variants, etymology, hanzi, rareMeaning, rareStory };
}

async function fetchDbStats() {
  const pool = getPool();
  const [chars] = await pool.query<any[]>(
    `SELECT level, COUNT(*) AS n FROM chars GROUP BY level ORDER BY level`,
  );
  const [rareTotal] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM rare_chars`,
  );
  const cov = readContentCoverage();
  return {
    byLevel: chars.map((r) => ({ level: Number(r.level), n: Number(r.n) })),
    rare: {
      total: Number(rareTotal[0].total),
      withMeaning: cov.rareMeaning,
      withStory: cov.rareStory,
    },
    dict: {
      zh: cov.zh,
      en: cov.en,
      alt: cov.alt,
      var: cov.var,
    },
    withStory: cov.etymology,
    hanzi: cov.hanzi,
  };
}

export default async function InitCharsPage() {
  const [stats, preserved, mockMode, model, baseUrl] = await Promise.all([
    fetchDbStats(),
    readPreservedStats(),
    getConfig('ai.mock_mode'),
    getConfig('ai.model'),
    getConfig('ai.base_url'),
  ]);
  return (
    <div>
      <h1 className="text-xl font-semibold mb-2">初始化 / 调试面板</h1>
      <p className="text-sm text-ink-soft mb-4">
        用于验证 <code>按级别批量生成</code> 端到端流程。只会动 <strong>20 个固定种子字符</strong> + 1 个 admin,不会触碰其它真实数据。
      </p>
      <InitCharsPanel
        initialMock={(mockMode ?? 'false') === 'true'}
        initialModel={model ?? ''}
        initialBaseUrl={baseUrl ?? ''}
        stats={stats}
        preserved={preserved}
      />
      <div className="mt-8">
        <h2 className="text-base font-semibold mb-2">批量生成 (走种子数据)</h2>
        <p className="text-xs text-ink-soft mb-3">
          下面的 tab 跑在同一个 <code>piyin_dev</code> 本地库上,Mock LLM 打开时不会消耗真实 API 配额。
        </p>
        <GenerateCharsForm />
      </div>
    </div>
  );
}
