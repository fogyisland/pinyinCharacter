/**
 * Init / system health checklist for the /admin/init page.
 *
 * Renders three sections — current environment, admin account, and a 12-step
 * checklist — so a fresh deploy can see at a glance what's configured and
 * what's still missing. Each step auto-runs a `check` function and shows
 * ✓ (ok), ⚠ (warn, optional), ✗ (fail, required-but-missing), or
 * gray dot (pending). All checks are read-only — they never mutate the DB.
 *
 * `runInitChecks()` is the only export; the page calls it server-side.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';
import { getConfig } from './config';
import { getRuntimeSiteUrl } from './seo/config';
import { isProd } from './env';
import { getSeedDataset, SEED_DATASETS } from './seed-registry';
import { readSeedCounts } from './seed-runner';
import { compareSchema, type SchemaComparison } from './schema-check';

export type StepStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  /** Unique id used as React key and for test selection. */
  id: string;
  /** Short name shown in the checklist row. */
  name: string;
  /** One-sentence explanation of what this step checks. */
  description: string;
  /**
   * `true` = missing-this would break the app (rendered as red ✗).
   * `false` = nice-to-have (rendered as yellow ⚠ when missing).
   */
  required: boolean;
  status: StepStatus;
  /** Short value or "missing"/"set" text shown under the name. */
  details?: string;
  /** Where to go to fix a fail/warn. Renders as a "去修" button. */
  fixHref?: string;
  /** Label for the fix button. Defaults to "去修". */
  fixLabel?: string;
}

export interface AdminUserInfo {
  id: number;
  username: string;
  createdAt: string;
}

export interface DbUrlParts {
  host: string;
  port: string;
  database: string;
  user: string;
  /** Always '***' — never expose the actual password. */
  password: string;
}

export interface InitContext {
  isProd: boolean;
  nodeEnv: string;
  dbUrl: string;
  dbUrlParts: DbUrlParts | null;
  /** Whether JWT_SECRET is the known dev default (a security smell in prod). */
  jwtSecretIsDevDefault: boolean;
  jwtSecretLength: number;
  adminCount: number;
  firstAdmin: AdminUserInfo | null;
  manifestExists: { content: boolean; poems: boolean; classics: boolean };
  tableCount: number;
  /**
   * How many tables the repository declares.
   *
   * This used to be a hand-written floor (`EXPECTED_TABLES = 22`) next to
   * a moving target — it drifted as migrations added tables, and a count
   * cannot tell a missing table from a missing column. It is now the
   * exact number derived from the repository's own schema sources, and
   * `0` when the schema probe could not run (meaning "unknown", not
   * "none expected").
   */
  expectedTableCount: number;
  /** Chars that carry an HSK grade. */
  hskGraded: number;
  /** Chars in total. */
  hskTotal: number;
  /** How many graded chars the import is expected to produce. */
  hskExpected: number;
}

export interface InitReport {
  context: InitContext;
  steps: CheckResult[];
}

// The table count is no longer hand-written here. The expectation is
// derived from the repository itself (the base DDL in scripts/init-db.ts
// plus scripts/migrations/*.sql) by lib/schema-expectations.ts, and
// compared per table and per column by lib/schema-check.ts.
//
// A hand-written count was wrong in two ways: it could not name what was
// missing, and a missing column did not move the count at all — so the
// step stayed green while the feature it guarded was broken. The count
// that survives below is only used as a fallback when the schema probe
// cannot run at all.
const DEV_DEFAULT_JWT = 'local-dev-secret-must-be-32-chars-long-1234';

export function parseDbUrl(url: string): DbUrlParts | null {
  // mysql://user:pass@host:port/db
  const m = url.match(/^mysql:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/([^?]+)/);
  if (!m) return null;
  return {
    user: m[1],
    password: '***',
    host: m[3],
    port: m[4] ?? '3306',
    database: m[5],
  };
}

async function safeQuery(sql: string, params: unknown[] = []): Promise<unknown> {
  try {
    const [rows] = await getPool().query(sql, params);
    return rows;
  } catch {
    return null;
  }
}

/** The `SELECT 1` connectivity probe row. */
interface PingRow extends RowDataPacket {
  ok: number;
}

/** A `COUNT(*)` row. */
interface CountRow extends RowDataPacket {
  n: number;
}

/**
 * Build the "required tables" step from the schema comparison.
 *
 * The step answers a question the old table-count check could not: **what
 * exactly is missing**. A count says "21 / 22" and leaves the operator to
 * diff forty-odd tables by hand; worse, a missing *column* does not move
 * the count at all, so the step stayed green while the feature it guarded
 * was broken in one corner of the site.
 *
 * So the details name the missing tables and columns, and the fix button
 * points at the admin screen that runs the migrations.
 *
 * When the probe itself failed, the step does **not** report success. An
 * unreadable database is not a healthy one — and the old check reported
 * green in exactly that case, because the count query had failed quietly
 * and left `tableCount` at zero against a floor it never reached by luck.
 */
function buildSchemaStep(comparison: SchemaComparison | null): CheckResult {
  const base = {
    id: 'db-tables',
    name: '必需表',
    description: '数据库的表和列是否跟得上代码(init-db.ts + 所有 migrations)',
    required: true,
    fixHref: '/admin/seed',
    fixLabel: '去补齐',
  };

  if (!comparison) {
    return {
      ...base,
      status: 'fail',
      details: '无法读取数据库结构 —— 请检查数据库连接后刷新页面。',
    };
  }

  const missingTables = comparison.missingTables;
  const missingColumns = comparison.missingColumns;
  const missingCount = missingTables.length + missingColumns.length;

  if (missingCount === 0) {
    return {
      ...base,
      status: 'ok',
      details:
        `表 ${comparison.actualTables} / 期望 ${comparison.expectedTables}` +
        ` · 列 ${comparison.actualColumns} / 期望 ${comparison.expectedColumns}`,
    };
  }

  // The tables come first — a missing table is the bigger fact, and its
  // columns are not listed separately (the table is what has to be
  // created first).
  //
  // The de-duplication is done here and not only upstream: `compareSchema`
  // is exported, and a display layer that assumes an invariant it does
  // not control is a display layer that breaks when that assumption
  // changes.
  const missingTableNames = new Set(comparison.missingTables.map((missing) => missing.table));
  const parts: string[] = [];
  for (const missing of comparison.missingTables) {
    parts.push(`缺表 ${missing.table}`);
  }
  for (const missing of comparison.missingColumns) {
    if (missingTableNames.has(missing.table)) continue;
    parts.push(`缺列 ${missing.table}.${missing.column}`);
  }

  return {
    ...base,
    status: 'fail',
    details: `${parts.join(' · ')}(共 ${parts.length} 项)`,
  };
}

/**
 * The HSK coverage row: how many chars exist, and how many carry a grade.
 */
interface HskCountRow extends RowDataPacket {
  total: number;
  graded: number;
}

/** The admin user row the checklist reads. */
interface AdminUserRow extends RowDataPacket {
  id: number;
  username: string;
  created_at: Date | string;
}

export async function runInitChecks(): Promise<InitReport> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const prod = isProd({ NODE_ENV: nodeEnv } as NodeJS.ProcessEnv);
  const dbUrl = process.env.DATABASE_URL ?? '';
  const jwtSecret = process.env.JWT_SECRET ?? '';

  // --- Gather raw context (best-effort; each block isolated) ---
  const pingRows = (await safeQuery('SELECT 1 AS ok')) as PingRow[] | null;
  const dbOk = pingRows !== null;

  const tableRows = (await safeQuery(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  )) as CountRow[] | null;
  const tableCount = tableRows && tableRows[0] ? Number(tableRows[0].n) : 0;

  // The schema probe compares the database against what the repository
  // declares, per table and per column. It is allowed to fail: "we could
  // not find out" is not the same as "it is fine", and the step below
  // reports the difference — never a false green.
  const comparison = await compareSchema().catch((error: unknown) => {
    console.error('[init-checklist] schema comparison failed:', error);
    return null;
  });

  const adminRows = (await safeQuery(
    `SELECT id, username, created_at FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1`,
  )) as AdminUserRow[] | null;
  const firstAdmin =
    adminRows && adminRows[0]
      ? {
          id: Number(adminRows[0].id),
          username: String(adminRows[0].username),
          createdAt:
            adminRows[0].created_at instanceof Date
              ? adminRows[0].created_at.toISOString()
              : String(adminRows[0].created_at),
        }
      : null;
  const adminCountRows = (await safeQuery(`SELECT COUNT(*) AS n FROM users WHERE is_admin = 1`)) as
    CountRow[] | null;
  const adminCount = adminCountRows && adminCountRows[0] ? Number(adminCountRows[0].n) : 0;

  // HSK grading coverage. `chars.hsk_level` is filled by the seed runner
  // (and, before that, by `scripts/import-hsk.ts` — a DEPLOYMENT script, not
  // a migration, so nothing ran it automatically). A server whose grading
  // was never imported answers 404 on every /game level and 503 on every
  // round, while every other checklist step is green.
  //
  // This step is what makes that failure visible in the admin panel instead
  // of in a learner's browser.
  const hskRows = (await safeQuery(
    `SELECT COUNT(*) AS total, COUNT(hsk_level) AS graded FROM chars`,
  )) as HskCountRow[] | null;
  const hskTotal = hskRows && hskRows[0] ? Number(hskRows[0].total) : 0;
  const hskGraded = hskRows && hskRows[0] ? Number(hskRows[0].graded) : 0;
  // The expected count comes from the seed registry, which reads the
  // repository's own `data/hsk-vocab.json`. It was 2632 when this step was
  // written, but hard-coding it would let the two drift apart again.
  const hskExpected = getSeedDataset('hsk-grading')?.expected ?? 2632;

  // app_config snapshot
  const configKeys = ['site.url', 'smtp.transport', 'smtp.from', 'ai.api_key', 'ai.model'];
  const config: Record<string, string | null> = {};
  for (const k of configKeys) {
    try {
      config[k] = await getConfig(k);
    } catch {
      config[k] = null;
    }
  }

  // Manifests
  const manifestExists = {
    content: existsSync(join(process.cwd(), 'data', 'content-manifest.json')),
    poems: existsSync(join(process.cwd(), 'data', 'poems-manifest.json')),
    classics: existsSync(join(process.cwd(), 'data', 'classics-manifest.json')),
  };

  // site URL — only meaningful in prod (in dev localhost is fine)
  let siteUrl: string;
  try {
    siteUrl = await getRuntimeSiteUrl();
  } catch {
    siteUrl = '';
  }
  const siteUrlIsLocalhost = !siteUrl || /localhost|127\.0\.0\.1/.test(siteUrl);

  // --- Build the 12 steps ---
  const steps: CheckResult[] = [];

  // 1. Database connection
  steps.push({
    id: 'db-connection',
    name: '数据库连接',
    description: '应用能连上 MySQL 并执行 SELECT 1',
    required: true,
    status: dbOk ? 'ok' : 'fail',
    details: dbOk
      ? `${parseDbUrl(dbUrl)?.host ?? '?'}:${parseDbUrl(dbUrl)?.port ?? '?'}/${parseDbUrl(dbUrl)?.database ?? '?'}`
      : '连接失败 — 检查 DATABASE_URL 与 MySQL 状态',
  });

    // 2. Required tables
  steps.push(buildSchemaStep(comparison));

  // 3. Admin user
  steps.push({
    id: 'admin-user',
    name: '管理员账户',
    description: '至少 1 个 is_admin=1 的用户存在',
    required: true,
    status: adminCount > 0 ? 'ok' : 'fail',
    details:
      adminCount > 0
        ? `${adminCount} 个 (${firstAdmin?.username})`
        : '无管理员 — 需注册后手动改 is_admin=1',
    fixHref: '/admin/users',
  });

  // 4. Site URL (required in prod)
  steps.push({
    id: 'site-url',
    name: '站点 URL',
    description: 'prod 下 sitemap/canonical 必须用真实域名,不能是 localhost',
    required: prod,
    status: prod ? (siteUrlIsLocalhost ? 'fail' : 'ok') : siteUrlIsLocalhost ? 'warn' : 'ok',
    details: siteUrlIsLocalhost ? `${siteUrl || '未设'} (dev 用可)` : siteUrl,
    fixHref: '/admin/settings/site-url',
  });

  // 5. SMTP transport
  steps.push({
    id: 'smtp-transport',
    name: '邮件传输',
    description: 'smtp.transport 设为 smtp 才真发邮件,否则只打 console',
    required: false,
    status: config['smtp.transport'] === 'smtp' ? 'ok' : 'warn',
    details:
      config['smtp.transport'] === 'smtp'
        ? 'smtp'
        : (config['smtp.transport'] ?? '未设 (默认 console)'),
    fixHref: '/admin/email',
  });

  // 6. SMTP from
  steps.push({
    id: 'smtp-from',
    name: '邮件发件人',
    description: 'smtp.from 是发件邮箱(密码重置 / 测试邮件需要)',
    required: false,
    status: config['smtp.from'] ? 'ok' : 'warn',
    details: config['smtp.from'] ?? '未设',
    fixHref: '/admin/email',
  });

  // 7. AI API key
  const hasAiKey = !!config['ai.api_key'] && config['ai.api_key']!.length > 0;
  steps.push({
    id: 'ai-key',
    name: 'AI API key',
    description: 'LLM 调用需要 api_key,缺了用 mock 模式也能跑',
    required: false,
    status: hasAiKey ? 'ok' : 'warn',
    details: hasAiKey ? '已设' : '未设 (Mock 模式或不可用)',
    fixHref: '/admin/ai',
  });

  // 8. AI model
  steps.push({
    id: 'ai-model',
    name: 'AI model',
    description: 'ai.model 指定调哪个 LLM (默认 MiniMax-M3)',
    required: false,
    status: config['ai.model'] ? 'ok' : 'warn',
    details: config['ai.model'] ?? '未设 (用代码默认值)',
    fixHref: '/admin/ai',
  });

  // 9-11. Manifests
  const manifestStep = (
    id: string,
    name: string,
    description: string,
    exists: boolean,
    fixHref: string,
  ): CheckResult => ({
    id,
    name,
    description,
    required: false,
    status: exists ? 'ok' : 'warn',
    details: exists ? '已生成' : '未生成 (导入后才有)',
    fixHref,
  });
  steps.push(
    manifestStep(
      'content-manifest',
      '内容清单 (content-manifest)',
      'data/content-manifest.json — 索引所有字符的内容文件',
      manifestExists.content,
      '/admin/chars',
    ),
  );
  steps.push(
    manifestStep(
      'poems-manifest',
      '诗清单 (poems-manifest)',
      'data/poems-manifest.json — 索引 /poetry 页面',
      manifestExists.poems,
      '/poetry',
    ),
  );
  steps.push(
    manifestStep(
      'classics-manifest',
      '经典清单 (classics-manifest)',
      'data/classics-manifest.json — 索引 /ancient 页面',
      manifestExists.classics,
      '/ancient',
    ),
  );

  // 12. JWT_SECRET (required in prod)
  const jwtStrong = jwtSecret.length >= 32 && jwtSecret !== DEV_DEFAULT_JWT;
  steps.push({
    id: 'jwt-secret',
    name: 'JWT 签名密钥',
    description: 'prod 下必须是 ≥32 字节且非 dev 默认值的随机串',
    required: prod,
    status: prod ? (jwtStrong ? 'ok' : 'fail') : jwtStrong ? 'ok' : 'warn',
    details: prod
      ? jwtStrong
        ? `${jwtSecret.length} 字节`
        : `${jwtSecret.length} 字节 (太短 / dev 默认)`
      : jwtSecret === DEV_DEFAULT_JWT
        ? 'dev 默认值 (dev 用可)'
        : `${jwtSecret.length} 字节`,
  });

  // 13. HSK grading coverage. Required in prod, because a server whose
  // grading was never imported answers 404 on every /game level and 503 on
  // every round — the whole games area is dead while every other step here
  // is green. `scripts/import-hsk.ts` fills this column, and it is a
  // deployment step, not a migration, so nothing runs it automatically.
  const hskOk = hskGraded >= hskExpected;
  steps.push({
    id: 'hsk-grading',
    name: 'HSK 分级数据',
    description: `chars.hsk_level 已分级 ≥ ${hskExpected} 字 — /game 闯关与小游戏依赖它`,
    required: prod,
    status: prod ? (hskOk ? 'ok' : 'fail') : hskOk ? 'ok' : 'warn',
    details: hskOk
      ? `${hskGraded} / ${hskTotal} 字已分级`
      : `${hskGraded} / ${hskTotal} 字已分级 (未导入) — /game 会 404/503`,
    fixHref: undefined, // no UI to fix; it is a CLI import
    fixLabel: '查看 import-hsk.ts',
  });

  // 14. The whole content seed. The step above covers the HSK grading
  // because it is the one whose absence breaks a whole feature area
  // silently. This step covers everything else: the rare chars, the
  // etymology rows, the poems, the classics and the sutras. A server can
  // answer 404 for a classic that was never imported while every other
  // check is green — the same failure class as the HSK one, one dataset
  // over.
  //
  // The expectations come from the seed registry, which reads the
  // repository's own data files, so this step and the import screen can
  // never disagree about what "complete" means.
  const seedCounts = await readSeedCounts();
  const seedDatasets = SEED_DATASETS.map((dataset) => {
    const actual = seedCounts[dataset.id] ?? 0;
    return { dataset, actual, missing: Math.max(0, dataset.expected - actual) };
  });
  const incomplete = seedDatasets.filter((d) => d.missing > 0);
  const missingRows = incomplete.reduce((sum, d) => sum + d.missing, 0);
  steps.push({
    id: 'content-seed',
    name: '内容 seed 就绪',
    description: `全部 ${SEED_DATASETS.length} 个内容数据集与仓库一致 — 缺额由启动时自动补齐,也可在此手动导入`,
    required: prod,
    status: prod
      ? incomplete.length === 0
        ? 'ok'
        : 'fail'
      : incomplete.length === 0
        ? 'ok'
        : 'warn',
    details:
      incomplete.length === 0
        ? `${SEED_DATASETS.length} 个数据集全部就绪`
        : `${incomplete.length} 个数据集缺 ${missingRows} 行 (${incomplete
            .map((d) => d.dataset.label)
            .join('、')})`,
    fixHref: '/admin/seed',
    fixLabel: '去导入',
  });

  const context: InitContext = {
    isProd: prod,
    nodeEnv,
    dbUrl,
    dbUrlParts: parseDbUrl(dbUrl),
    jwtSecretIsDevDefault: jwtSecret === DEV_DEFAULT_JWT,
    jwtSecretLength: jwtSecret.length,
    adminCount,
    firstAdmin,
    manifestExists,
    tableCount,
    expectedTableCount: comparison ? comparison.expectedTables : 0,
    hskGraded,
    hskTotal,
    hskExpected,
  };

  return { context, steps };
}
