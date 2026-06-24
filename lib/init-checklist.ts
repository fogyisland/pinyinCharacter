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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from './db';
import { getConfig } from './config';
import { getRuntimeSiteUrl } from './seo/config';
import { isProd } from './env';

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
  expectedTableCount: number;
}

export interface InitReport {
  context: InitContext;
  steps: CheckResult[];
}

// Minimum table count for a fully-migrated piyin schema. The base schema is
// defined in scripts/init-db.ts (16 tables); the rest come from subsequent
// migrations (memberships, payment_orders, sutra_copy_progress, char_story).
// If the count drops below this, the DB is missing a migration.
const EXPECTED_TABLES = 22;
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

export async function runInitChecks(): Promise<InitReport> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const prod = isProd({ NODE_ENV: nodeEnv } as NodeJS.ProcessEnv);
  const dbUrl = process.env.DATABASE_URL ?? '';
  const jwtSecret = process.env.JWT_SECRET ?? '';

  // --- Gather raw context (best-effort; each block isolated) ---
  const pingRows = (await safeQuery('SELECT 1 AS ok')) as any[] | null;
  const dbOk = pingRows !== null;

  const tableRows = (await safeQuery(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  )) as any[] | null;
  const tableCount = tableRows && tableRows[0] ? Number(tableRows[0].n) : 0;

  const adminRows = (await safeQuery(
    `SELECT id, username, created_at FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1`,
  )) as any[] | null;
  const firstAdmin = adminRows && adminRows[0]
    ? {
        id: Number(adminRows[0].id),
        username: String(adminRows[0].username),
        createdAt: adminRows[0].created_at instanceof Date
          ? adminRows[0].created_at.toISOString()
          : String(adminRows[0].created_at),
      }
    : null;
  const adminCountRows = (await safeQuery(
    `SELECT COUNT(*) AS n FROM users WHERE is_admin = 1`,
  )) as any[] | null;
  const adminCount = adminCountRows && adminCountRows[0] ? Number(adminCountRows[0].n) : 0;

  // app_config snapshot
  const configKeys = [
    'site.url', 'smtp.transport', 'smtp.from', 'ai.api_key', 'ai.model',
  ];
  const config: Record<string, string | null> = {};
  for (const k of configKeys) {
    try { config[k] = await getConfig(k); }
    catch { config[k] = null; }
  }

  // Manifests
  const manifestExists = {
    content: existsSync(join(process.cwd(), 'data', 'content-manifest.json')),
    poems: existsSync(join(process.cwd(), 'data', 'poems-manifest.json')),
    classics: existsSync(join(process.cwd(), 'data', 'classics-manifest.json')),
  };

  // site URL — only meaningful in prod (in dev localhost is fine)
  let siteUrl: string;
  try { siteUrl = await getRuntimeSiteUrl(); }
  catch { siteUrl = ''; }
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
  steps.push({
    id: 'db-tables',
    name: '必需表',
    description: `init-db.ts + 所有 migrations 至少 ${EXPECTED_TABLES} 张表(chars/users/audit_log/...)`,
    required: true,
    status: tableCount >= EXPECTED_TABLES ? 'ok' : 'fail',
    details: `实际 ${tableCount} / 期望 ≥ ${EXPECTED_TABLES}`,
    fixHref: undefined,  // no UI to fix; tell user to run `pnpm tsx scripts/init-db.ts`
    fixLabel: '查看 init-db.ts',
  });

  // 3. Admin user
  steps.push({
    id: 'admin-user',
    name: '管理员账户',
    description: '至少 1 个 is_admin=1 的用户存在',
    required: true,
    status: adminCount > 0 ? 'ok' : 'fail',
    details: adminCount > 0
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
    status: prod ? (siteUrlIsLocalhost ? 'fail' : 'ok') : (siteUrlIsLocalhost ? 'warn' : 'ok'),
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
    details: config['smtp.transport'] === 'smtp' ? 'smtp' : (config['smtp.transport'] ?? '未设 (默认 console)'),
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
  steps.push(manifestStep(
    'content-manifest',
    '内容清单 (content-manifest)',
    'data/content-manifest.json — 索引所有字符的内容文件',
    manifestExists.content,
    '/admin/chars',
  ));
  steps.push(manifestStep(
    'poems-manifest',
    '诗清单 (poems-manifest)',
    'data/poems-manifest.json — 索引 /poetry 页面',
    manifestExists.poems,
    '/poetry',
  ));
  steps.push(manifestStep(
    'classics-manifest',
    '经典清单 (classics-manifest)',
    'data/classics-manifest.json — 索引 /ancient 页面',
    manifestExists.classics,
    '/ancient',
  ));

  // 12. JWT_SECRET (required in prod)
  const jwtStrong = jwtSecret.length >= 32 && jwtSecret !== DEV_DEFAULT_JWT;
  steps.push({
    id: 'jwt-secret',
    name: 'JWT 签名密钥',
    description: 'prod 下必须是 ≥32 字节且非 dev 默认值的随机串',
    required: prod,
    status: prod ? (jwtStrong ? 'ok' : 'fail') : (jwtStrong ? 'ok' : 'warn'),
    details: prod
      ? (jwtStrong ? `${jwtSecret.length} 字节` : `${jwtSecret.length} 字节 (太短 / dev 默认)`)
      : (jwtSecret === DEV_DEFAULT_JWT ? 'dev 默认值 (dev 用可)' : `${jwtSecret.length} 字节`),
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
    expectedTableCount: EXPECTED_TABLES,
  };

  return { context, steps };
}
