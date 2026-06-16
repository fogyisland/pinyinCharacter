import { getPool } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { InitCharsPanel } from '@/components/admin/InitCharsPanel';
import { GenerateCharsForm } from '@/components/admin/GenerateCharsForm';

export const dynamic = 'force-dynamic';

async function fetchDbStats() {
  const pool = getPool();
  const [chars] = await pool.query<any[]>(
    `SELECT level, COUNT(*) AS n FROM chars GROUP BY level ORDER BY level`,
  );
  const [etym] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM char_etymology WHERE story IS NOT NULL AND story <> ''`,
  );
  const [rare] = await pool.query<any[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN meaning <> '' THEN 1 ELSE 0 END) AS with_meaning,
       SUM(CASE WHEN story <> '' THEN 1 ELSE 0 END) AS with_story
     FROM rare_chars`,
  );
  const [dict] = await pool.query<any[]>(
    `SELECT
       SUM(CASE WHEN meaning_zh IS NOT NULL AND meaning_zh <> '' THEN 1 ELSE 0 END) AS zh,
       SUM(CASE WHEN meaning_en IS NOT NULL AND meaning_en <> '' THEN 1 ELSE 0 END) AS en,
       SUM(CASE WHEN pinyin_alt IS NOT NULL THEN 1 ELSE 0 END) AS alt,
       SUM(CASE WHEN variants IS NOT NULL THEN 1 ELSE 0 END) AS var
     FROM chars`,
  );
  return {
    byLevel: chars.map((r) => ({ level: Number(r.level), n: Number(r.n) })),
    withStory: Number(etym[0].n),
    rare: {
      total: Number(rare[0].total),
      withMeaning: Number(rare[0].with_meaning ?? 0),
      withStory: Number(rare[0].with_story ?? 0),
    },
    dict: {
      zh: Number(dict[0].zh ?? 0),
      en: Number(dict[0].en ?? 0),
      alt: Number(dict[0].alt ?? 0),
      var: Number(dict[0].var ?? 0),
    },
  };
}

export default async function InitCharsPage() {
  const [stats, mockMode, model, baseUrl] = await Promise.all([
    fetchDbStats(),
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
