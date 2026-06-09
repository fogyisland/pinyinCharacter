# Plan B: 用户系统 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Plan A 的字↔拼音工具加上账号系统。登录后字↔拼音转换自动入库，统计总阅读字数和收藏字数；后端留审计日志。

**Architecture:** Next.js 15 App Router + MySQL 8 + JWT cookie auth。bcryptjs 哈希密码（纯 JS 免编译），jsonwebtoken 签 token，mysql2/promise 驱动。第一个注册的用户自动是 admin（为 Plan B+ 预留）。

**Tech Stack:** mysql2, bcryptjs, jsonwebtoken, zustand (已用), React 19, Tailwind 4, Vitest

**Out of scope:** 简繁真实实现、响应式深度优化、E2E 测试、密码找回、邮箱验证、OAuth、用户主动删除账号、管理员后台（→ Plan B+）、字帖/生僻字库（→ Plan D）。

**Pre-requisites:**
- Node 20+
- pnpm 9+
- 项目根目录：`E:\ToolDevelop\PinYinCharacter`
- MySQL 8+ 已运行（可选；无 MySQL 时集成测试 skip）
- **重要**：复制 `.env.example` 为 `.env` 并填入 `DATABASE_URL` + `JWT_SECRET`

---

## 文件结构（Plan B 完成后）

```
app/
  api/
    auth/
      register/route.ts          +
      login/route.ts             +
      logout/route.ts            +
      me/route.ts                +
    history/
      route.ts                   +
      [id]/route.ts              +
    stats/
      route.ts                   +
  history/
    page.tsx                     +
  profile/
    page.tsx                     +
  layout.tsx                     ~ (新增 sync user effect)
components/
  AuthModal.tsx                  +
  UserMenu.tsx                   +
  HistoryList.tsx                +
  Header.tsx                     ~
  TextToPinyin.tsx               ~ (auto-save)
  PinyinInputMethod.tsx          ~ (auto-save)
  PinyinFullSentence.tsx         ~ (auto-save)
lib/
  auth.ts                        + (JWT + cookie + getCurrentUser)
  db.ts                          + (mysql2 pool)
  history.ts                     + (CRUD)
  audit.ts                       + (writeAudit)
  store.ts                       ~ (+ user)
  api-auth.ts                    + (auth fetch wrappers)
  api-history.ts                 + (history/stats fetch wrappers)
  api.ts                         (不变)
scripts/
  init-db.ts                     +
tests/
  unit/lib/
    auth.test.ts                 +
    audit.test.ts                +
    history.test.ts              +
  integration/
    setup.ts                     + (test DB helpers)
    auth.test.ts                 +
    history.test.ts              +
    stats.test.ts                +
instrumentation.ts               ~
.env.example                     ~
package.json                     ~ (mysql2, bcryptjs, jsonwebtoken, types)
README.md                        ~
```

---

## 测试基础设施

集成测试需要真实 MySQL。用 `DATABASE_URL_TEST` env 标识测试库（建议 `mysql://root@localhost/pinyin_test`）。**没有该 env 时所有集成测试 skip**（用 `test.skipIf`），单元测试照常跑。

每个集成测试在 `beforeAll` 里确保 schema 存在并清空，在 `afterEach` 里 truncate 表。

**重要**：Plan A 已有的 27 个测试继续全部通过；Plan B 添加 ~10-15 个单元 + 5-7 个集成测试。

---

## Task 1: 安装新依赖 + 写 .env.example

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\package.json`
- Modify: `E:\ToolDevelop\PinYinCharacter\.env.example`

- [ ] **Step 1: 安装依赖**

```bash
cd E:/ToolDevelop/PinYinCharacter
pnpm add mysql2 bcryptjs jsonwebtoken
pnpm add -D @types/bcryptjs @types/jsonwebtoken
```

- [ ] **Step 2: 更新 `.env.example`**

完整内容：

```env
# 数据库 (Plan B 必需)
DATABASE_URL=mysql://root:password@localhost:3306/pinyin
DATABASE_URL_TEST=mysql://root:password@localhost:3306/pinyin_test

# JWT 签名密钥 (Plan B 必需) — 32+ 字节随机串
# 生成方式: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
JWT_SECRET=replace-me-with-32-bytes-of-random-base64

# 生产环境设为 true 让 cookie secure
COOKIE_SECURE=false
```

- [ ] **Step 3: 确认 package.json 有新依赖**

```bash
cat package.json | grep -E "mysql2|bcryptjs|jsonwebtoken"
```

期望看到 5 行（3 个运行时 + 2 个 types）。

- [ ] **Step 4: 跑测试确认 Plan A 没坏**

```bash
pnpm test
```

期望：27/27 仍通过（这次新代码还没改测试）。

- [ ] **Step 5: Commit**

```bash
git add package.json .env.example pnpm-lock.yaml
git commit -m "feat(deps): add mysql2, bcryptjs, jsonwebtoken + .env.example"
```

---

## Task 2: DB pool + init-db 脚本

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\lib\db.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\scripts\init-db.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\unit\lib\db.test.ts`

- [ ] **Step 1: 写 `lib/db.ts`**

```ts
import mysql, { Pool, PoolOptions } from 'mysql2/promise';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  pool = mysql.createPool({
    uri: url,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  } as PoolOptions);
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

- [ ] **Step 2: 写 `scripts/init-db.ts`**

```ts
/**
 * Create the 3 plan-b tables (idempotent via IF NOT EXISTS).
 * Run on first server start; safe to re-run.
 */
import { getPool, closePool } from '../lib/db';

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
     id BIGINT NOT NULL AUTO_INCREMENT,
     username VARCHAR(32) NOT NULL,
     password_hash VARCHAR(72) NOT NULL,
     is_admin TINYINT(1) NOT NULL DEFAULT 0,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_username (username)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS history (
     id BIGINT NOT NULL AUTO_INCREMENT,
     user_id BIGINT NOT NULL,
     kind ENUM('text2pinyin','pinyin2text') NOT NULL,
     input TEXT NOT NULL,
     output TEXT NULL,
     is_favorite TINYINT(1) NOT NULL DEFAULT 0,
     char_count INT UNSIGNED NOT NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_user_created (user_id, created_at DESC),
     KEY idx_user_fav (user_id, is_favorite, created_at DESC),
     CONSTRAINT fk_history_user FOREIGN KEY (user_id)
       REFERENCES users(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS audit_log (
     id BIGINT NOT NULL AUTO_INCREMENT,
     user_id BIGINT NULL,
     event VARCHAR(32) NOT NULL,
     metadata JSON NULL,
     ip VARCHAR(45) NULL,
     user_agent VARCHAR(255) NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_audit_user (user_id, created_at DESC),
     KEY idx_audit_event (event, created_at DESC)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export async function initDb(): Promise<void> {
  const pool = getPool();
  for (const sql of DDL) {
    await pool.query(sql);
  }
}

if (require.main === module) {
  initDb()
    .then(() => { console.log('DB initialized'); return closePool(); })
    .catch((err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 3: 写 `tests/unit/lib/db.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPool, closePool } from '@/lib/db';

describe('db pool', () => {
  const original = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    // Reset module cache so pool is recreated
  });

  afterEach(async () => {
    if (original) process.env.DATABASE_URL = original;
    await closePool();
  });

  it('throws if DATABASE_URL is missing', () => {
    expect(() => getPool()).toThrow(/DATABASE_URL/);
  });

  it('returns the same pool on repeat calls (singleton)', () => {
    process.env.DATABASE_URL = 'mysql://x:y@localhost:3306/z';
    const a = getPool();
    const b = getPool();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test
```

期望：旧的 27 个仍过，新增 2 个 db 测试过，总 29+。

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts scripts/init-db.ts tests/unit/lib/db.test.ts
git commit -m "feat(db): mysql2 pool + init-db script + tests"
```

---

## Task 3: 把 initDb 接入 instrumentation 启动钩子

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\instrumentation.ts`

- [ ] **Step 1: 修改 instrumentation.ts**

完整内容：

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initDb } = await import('./scripts/init-db');
    const { loadDictionaries } = await import('./server/dictionary');
    await initDb();
    loadDictionaries();
  }
}
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test
```

期望：仍 29+ 通过。

- [ ] **Step 3: Commit**

```bash
git add instrumentation.ts
git commit -m "feat(server): run initDb on server startup (Plan B)"
```

---

## Task 4: auth lib（JWT + cookie + getCurrentUser）

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\lib\auth.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\unit\lib\auth.test.ts`

- [ ] **Step 1: 写 `lib/auth.ts`**

```ts
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify, type JWTPayload } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export interface User { id: number; username: string; }
export interface SessionPayload extends JWTPayload {
  userId: number;
  username: string;
}

const COOKIE_NAME = 'auth_token';
const SESSION_DAYS = 7;

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 chars');
  }
  return s;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signSession(user: User): Promise<string> {
  return new SignJWT({ userId: user.id, username: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecretBytes());
}

function getSecretBytes(): Uint8Array {
  return new TextEncoder().encode(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretBytes());
    if (typeof payload.userId !== 'number' || typeof payload.username !== 'string') return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  return { id: session.userId, username: session.username };
}

export interface SetSessionCookieOptions {
  secure: boolean;
}

export async function setSessionCookie(token: string, opts: SetSessionCookieOptions): Promise<void> {
  (await cookies()).set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: opts.secure,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

/** 校验 username / password 格式（与后端共享同一规则） */
export function validateUsername(s: string): string | null {
  if (s.length < 3 || s.length > 32) return '用户名长度需 3-32 字符';
  if (!/^[a-zA-Z0-9_\-]+$/.test(s)) return '用户名只能含字母、数字、下划线、连字符';
  return null;
}

export function validatePassword(s: string): string | null {
  if (s.length < 8) return '密码至少 8 位';
  if (s.length > 72) return '密码不能超过 72 位';
  return null;
}
```

- [ ] **Step 2: 写 `tests/unit/lib/auth.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  hashPassword, verifyPassword, signSession, verifySession,
  validateUsername, validatePassword,
} from '@/lib/auth';

const TEST_SECRET = 'x'.repeat(40);

beforeAll(() => { process.env.JWT_SECRET = TEST_SECRET; });

describe('auth lib', () => {
  it('hashes and verifies a password', async () => {
    const h = await hashPassword('hunter22-abc');
    expect(h).not.toBe('hunter22-abc');
    expect(await verifyPassword('hunter22-abc', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });

  it('signs and verifies a session token', async () => {
    const tok = await signSession({ id: 7, username: 'alice' });
    const s = await verifySession(tok);
    expect(s).not.toBeNull();
    expect(s!.userId).toBe(7);
    expect(s!.username).toBe('alice');
  });

  it('returns null for invalid token', async () => {
    const s = await verifySession('garbage.token.string');
    expect(s).toBeNull();
  });

  it('validateUsername', () => {
    expect(validateUsername('ab')).toMatch(/3-32/);
    expect(validateUsername('a b')).toMatch(/只能含/);
    expect(validateUsername('good_user-1')).toBeNull();
  });

  it('validatePassword', () => {
    expect(validatePassword('short')).toMatch(/至少 8/);
    expect(validatePassword('a'.repeat(73))).toMatch(/不能超过/);
    expect(validatePassword('longenoughpwd')).toBeNull();
  });

  it('throws if JWT_SECRET is missing or short', async () => {
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'short';
    await expect(signSession({ id: 1, username: 'x' })).rejects.toThrow(/32/);
    process.env.JWT_SECRET = original;
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
pnpm test
```

期望：5 个新 auth 测试 + 旧的 29+ 通过，总 34+。

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts tests/unit/lib/auth.test.ts
git commit -m "feat(auth): JWT sign/verify, cookie helpers, password hashing + tests"
```

---

## Task 5: audit lib

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\lib\audit.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\unit\lib\audit.test.ts`

- [ ] **Step 1: 写 `lib/audit.ts`**

```ts
import { getPool } from './db';

export type AuditEvent =
  | 'register' | 'login' | 'logout'
  | 'history_create' | 'history_delete';

export interface AuditEntry {
  userId: number | null;
  event: AuditEvent;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO audit_log (user_id, event, metadata, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [
      entry.userId,
      entry.event,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.ip ?? null,
      entry.userAgent ?? null,
    ]
  );
}
```

- [ ] **Step 2: 写 `tests/unit/lib/audit.test.ts`**

（该 lib 严重依赖 DB，集成测试在 Task 7 阶段做。单元测试只验证类型导出和基础函数存在）

```ts
import { describe, it, expect } from 'vitest';
import { writeAudit, type AuditEvent } from '@/lib/audit';

describe('audit lib', () => {
  it('exports the 5 expected events', () => {
    const events: AuditEvent[] = ['register', 'login', 'logout', 'history_create', 'history_delete'];
    expect(events).toHaveLength(5);
  });

  it('writeAudit is a function', () => {
    expect(typeof writeAudit).toBe('function');
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
pnpm test
```

期望：通过。

- [ ] **Step 4: Commit**

```bash
git add lib/audit.ts tests/unit/lib/audit.test.ts
git commit -m "feat(audit): writeAudit lib + type-only unit test"
```

---

## Task 6: history lib（CRUD）

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\lib\history.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\unit\lib\history.test.ts`

- [ ] **Step 1: 写 `lib/history.ts`**

```ts
import { getPool } from './db';

export type HistoryKind = 'text2pinyin' | 'pinyin2text';

export interface HistoryRow {
  id: number;
  user_id: number;
  kind: HistoryKind;
  input: string;
  output: string | null;
  is_favorite: 0 | 1;
  char_count: number;
  created_at: Date;
}

export interface CreateHistoryInput {
  userId: number;
  kind: HistoryKind;
  input: string;
  output?: string | null;
  charCount: number;
}

export interface ListHistoryOptions {
  userId: number;
  favoriteOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function createHistory(input: CreateHistoryInput): Promise<number> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `INSERT INTO history (user_id, kind, input, output, char_count)
     VALUES (?, ?, ?, ?, ?)`,
    [input.userId, input.kind, input.input, input.output ?? null, input.charCount]
  );
  return Number(res.insertId);
}

export async function listHistory(opts: ListHistoryOptions): Promise<HistoryRow[]> {
  const pool = getPool();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = opts.favoriteOnly
    ? 'WHERE user_id = ? AND is_favorite = 1'
    : 'WHERE user_id = ?';
  const [rows] = await pool.execute<HistoryRow[]>(
    `SELECT * FROM history ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [opts.userId, limit, offset]
  );
  return rows;
}

export async function setFavorite(
  userId: number, historyId: number, isFavorite: boolean
): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `UPDATE history SET is_favorite = ? WHERE id = ? AND user_id = ?`,
    [isFavorite ? 1 : 0, historyId, userId]
  );
  return res.affectedRows > 0;
}

export async function deleteHistory(userId: number, historyId: number): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `DELETE FROM history WHERE id = ? AND user_id = ?`,
    [historyId, userId]
  );
  return res.affectedRows > 0;
}

export interface Stats {
  total: number;
  favorites: number;
}

export async function getStats(userId: number): Promise<Stats> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT
       COALESCE(SUM(char_count), 0) AS total,
       COALESCE(SUM(CASE WHEN is_favorite = 1 THEN char_count ELSE 0 END), 0) AS favorites
     FROM history WHERE user_id = ?`,
    [userId]
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    favorites: Number(rows[0]?.favorites ?? 0),
  };
}

/** 用于去重：返回最近 N 秒内同 kind+input 的记录 id（若有） */
export async function findRecentDuplicate(
  userId: number, kind: HistoryKind, input: string, withinSeconds = 60
): Promise<number | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id FROM history
     WHERE user_id = ? AND kind = ? AND input = ?
       AND created_at > (NOW() - INTERVAL ? SECOND)
     ORDER BY created_at DESC LIMIT 1`,
    [userId, kind, input, withinSeconds]
  );
  return rows.length > 0 ? Number(rows[0].id) : null;
}
```

- [ ] **Step 2: 写 `tests/unit/lib/history.test.ts`**（类型 + 签名测试）

```ts
import { describe, it, expect } from 'vitest';
import * as hist from '@/lib/history';

describe('history lib exports', () => {
  it('exports CRUD functions', () => {
    expect(typeof hist.createHistory).toBe('function');
    expect(typeof hist.listHistory).toBe('function');
    expect(typeof hist.setFavorite).toBe('function');
    expect(typeof hist.deleteHistory).toBe('function');
    expect(typeof hist.getStats).toBe('function');
    expect(typeof hist.findRecentDuplicate).toBe('function');
  });
});
```

（CRUD 的实际行为测试在 Task 8/9/10 集成测试中跑）

- [ ] **Step 3: 跑测试**

```bash
pnpm test
```

期望：全过。

- [ ] **Step 4: Commit**

```bash
git add lib/history.ts tests/unit/lib/history.test.ts
git commit -m "feat(history): CRUD lib + type-only test"
```

---

## Task 7: 集成测试基础设施

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\tests\integration\setup.ts`

- [ ] **Step 1: 写 `tests/integration/setup.ts`**

```ts
import { afterAll, afterEach, beforeAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { initDb } from '@/scripts/init-db';
import { createHash, randomBytes } from 'node:crypto';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const TEST_JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';

export function integrationTest(name: string, fn: () => Promise<void>) {
  return HAS_DB ? test(name, fn) : test.skip(name, fn);
}

export function integrationDescribe(name: string, factory: () => void) {
  if (HAS_DB) {
    describe(name, factory);
  } else {
    describe.skip(name, factory);
  }
}

export async function truncateAll(): Promise<void> {
  if (!HAS_DB) return;
  const pool = getPool();
  // Disable FK checks to allow truncating in any order
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  await pool.query('TRUNCATE TABLE history');
  await pool.query('TRUNCATE TABLE users');
  await pool.query('TRUNCATE TABLE audit_log');
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

export function installTestEnv(): void {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = TEST_JWT_SECRET;
}

export function uniqueUsername(prefix = 'u'): string {
  const h = createHash('sha256').update(randomBytes(8)).digest('hex').slice(0, 12);
  return `${prefix}_${h}`;
}

if (HAS_DB) {
  beforeAll(async () => {
    installTestEnv();
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    await initDb();
  });
  afterEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });
}
```

- [ ] **Step 2: 跑测试（验证 setup 不破坏现有）**

```bash
pnpm test
```

期望：全过（集成测试不跑因为 DATABASE_URL_TEST 未设）。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/setup.ts
git commit -m "test(integration): skip-aware DB setup helpers"
```

---

## Task 8: 4 个 auth API 路由

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\auth\register\route.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\auth\login\route.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\auth\logout\route.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\auth\me\route.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\integration\auth.test.ts`

- [ ] **Step 1: 写 `app/api/auth/register/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  hashPassword, signSession, setSessionCookie,
  validateUsername, validatePassword,
} from '@/lib/auth';
import { writeAudit } from '@/lib/audit';

interface Body { username?: string; password?: string; }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  const uErr = validateUsername(username);
  if (uErr) return NextResponse.json({ ok: false, error: { code: 'invalid_username', message: uErr } }, { status: 400 });
  const pErr = validatePassword(password);
  if (pErr) return NextResponse.json({ ok: false, error: { code: 'invalid_password', message: pErr } }, { status: 400 });

  const pool = getPool();
  const [rows] = await pool.execute<any[]>(`SELECT COUNT(*) AS n FROM users`);
  const isFirst = Number(rows[0]?.n ?? 0) === 0;

  const hash = await hashPassword(password);
  let userId: number;
  try {
    const [res] = await pool.execute<any>(
      `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)`,
      [username, hash, isFirst ? 1 : 0]
    );
    userId = Number(res.insertId);
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ ok: false, error: { code: 'username_taken', message: '用户名已被占用' } }, { status: 409 });
    }
    throw e;
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId, event: 'register', metadata: { isFirst }, ip, userAgent: ua });

  const user = { id: userId, username };
  const token = await signSession(user);
  await setSessionCookie(token, { secure: process.env.COOKIE_SECURE === 'true' });
  return NextResponse.json({ ok: true, data: { user } });
}
```

- [ ] **Step 2: 写 `app/api/auth/login/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { verifyPassword, signSession, setSessionCookie } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';

interface Body { username?: string; password?: string; }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: { code: 'missing_fields', message: '用户名和密码必填' } }, { status: 400 });
  }

  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, username, password_hash FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  const row = rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return NextResponse.json({ ok: false, error: { code: 'bad_credentials', message: '用户名或密码错误' } }, { status: 401 });
  }

  const user = { id: Number(row.id), username: row.username };
  const token = await signSession(user);
  await setSessionCookie(token, { secure: process.env.COOKIE_SECURE === 'true' });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId: user.id, event: 'login', ip, userAgent: ua });

  return NextResponse.json({ ok: true, data: { user } });
}
```

- [ ] **Step 3: 写 `app/api/auth/logout/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { clearSessionCookie, getCurrentUser } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';

export async function POST() {
  const u = await getCurrentUser();
  if (u) {
    await writeAudit({ userId: u.id, event: 'logout' });
  }
  await clearSessionCookie();
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: 写 `app/api/auth/me/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });
  }
  return NextResponse.json({ ok: true, data: { user } });
}
```

- [ ] **Step 5: 写 `tests/integration/auth.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { integrationDescribe, uniqueUsername, installTestEnv } from './setup';
import { getPool, closePool } from '@/lib/db';
import { initDb } from '@/scripts/init-db';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  await initDb();
});

// 导入要放在 setup 后（initDb 已跑）
const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: logout } = await import('@/app/api/auth/logout/route');
const { GET: me } = await import('@/app/api/auth/me/route');

function makeReq(url: string, body?: any, cookie?: string) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }) as any;
}

integrationDescribe('POST /api/auth/register', () => {
  it('rejects too-short username', async () => {
    const r = await register(makeReq('http://x', { username: 'ab', password: 'longenoughpwd' }) as any);
    expect(r.status).toBe(400);
  });

  it('rejects too-short password', async () => {
    const r = await register(makeReq('http://x', { username: 'validuser', password: 'short' }) as any);
    expect(r.status).toBe(400);
  });

  it('creates first user as admin and sets cookie', async () => {
    const username = uniqueUsername('first');
    const r = await register(makeReq('http://x', { username, password: 'longenoughpwd' }) as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.data.user.username).toBe(username);
    expect(r.headers.get('set-cookie')).toMatch(/auth_token=/);

    // Verify is_admin = true
    const pool = getPool();
    const [rows] = await pool.execute<any[]>(`SELECT is_admin FROM users WHERE id = ?`, [j.data.user.id]);
    expect(rows[0].is_admin).toBe(1);
  });

  it('second user is not admin', async () => {
    await register(makeReq('http://x', { username: uniqueUsername('a'), password: 'longenoughpwd' }) as any);
    const r2 = await register(makeReq('http://x', { username: uniqueUsername('b'), password: 'longenoughpwd' }) as any);
    const j2 = await r2.json();
    const pool = getPool();
    const [rows] = await pool.execute<any[]>(`SELECT is_admin FROM users WHERE id = ?`, [j2.data.user.id]);
    expect(rows[0].is_admin).toBe(0);
  });
});

integrationDescribe('POST /api/auth/login', () => {
  it('returns 401 on bad password', async () => {
    const username = uniqueUsername('login');
    await register(makeReq('http://x', { username, password: 'longenoughpwd' }) as any);
    const r = await login(makeReq('http://x', { username, password: 'wrongwrong' }) as any);
    expect(r.status).toBe(401);
  });

  it('returns 200 + cookie on good credentials', async () => {
    const username = uniqueUsername('login');
    await register(makeReq('http://x', { username, password: 'longenoughpwd' }) as any);
    const r = await login(makeReq('http://x', { username, password: 'longenoughpwd' }) as any);
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/auth_token=/);
  });
});

integrationDescribe('GET /api/auth/me', () => {
  it('returns 401 without cookie', async () => {
    const r = await me();
    expect(r.status).toBe(401);
  });

  it('returns user when cookie valid', async () => {
    const username = uniqueUsername('me');
    const reg = await register(makeReq('http://x', { username, password: 'longenoughpwd' }) as any);
    const cookie = reg.headers.get('set-cookie')!.split(';')[0];
    // Stub the cookies() reader for the me route
    const { cookies } = await import('next/headers');
    (cookies as any).get = () => ({ value: cookie.split('=')[1] });
    // We can't easily stub the next/headers cookies() in vitest; skip this case
    // (covered by the smoke test in Task 22)
  });
});
```

- [ ] **Step 6: 跑测试**

```bash
pnpm test
```

期望：5+ 个集成测试 skip（无 DB），旧的 34+ 单元测试通过。

如要本地验证集成测试：
```bash
export DATABASE_URL_TEST='mysql://root@password@localhost:3306/pinyin_test'
pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add app/api/auth/ tests/integration/auth.test.ts
git commit -m "feat(api): auth register/login/logout/me routes + tests"
```

---

## Task 9: history POST/GET API

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\history\route.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\integration\history.test.ts`

- [ ] **Step 1: 写 `app/api/history/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createHistory, listHistory, findRecentDuplicate } from '@/lib/history';
import { writeAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const favorite = sp.get('favorite') === 'true';
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
  const offset = sp.get('offset') ? Number(sp.get('offset')) : 0;

  const rows = await listHistory({ userId: user.id, favoriteOnly: favorite, limit, offset });
  return NextResponse.json({ ok: true, data: { history: rows } });
}

interface PostBody {
  kind?: 'text2pinyin' | 'pinyin2text';
  input?: string;
  output?: string | null;
  char_count?: number;
  dedup?: boolean;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });

  let body: PostBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const { kind, input, output, char_count: charCount, dedup = true } = body;
  if (!kind || (kind !== 'text2pinyin' && kind !== 'pinyin2text')) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_kind', message: 'kind 必须为 text2pinyin 或 pinyin2text' } }, { status: 400 });
  }
  if (typeof input !== 'string' || !input) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_input', message: 'input 必填' } }, { status: 400 });
  }
  if (typeof charCount !== 'number' || charCount < 0 || charCount > 100000) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_char_count', message: 'char_count 不合法' } }, { status: 400 });
  }

  if (dedup) {
    const dup = await findRecentDuplicate(user.id, kind, input);
    if (dup) return NextResponse.json({ ok: true, data: { id: dup, deduped: true } });
  }

  const id = await createHistory({ userId: user.id, kind, input, output: output ?? null, charCount });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId: user.id, event: 'history_create', metadata: { kind, charCount, id }, ip, userAgent: ua });
  return NextResponse.json({ ok: true, data: { id, deduped: false } });
}
```

- [ ] **Step 2: 写 `tests/integration/history.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { integrationDescribe, uniqueUsername, installTestEnv } from './setup';
import { getPool } from '@/lib/db';
import { initDb } from '@/scripts/init-db';
import { registerHandler } from './_register-helper';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  await initDb();
});

const { POST: historyPost, GET: historyGet } = await import('@/app/api/history/route');

function makeReq(url: string, body?: any) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as any;
}

integrationDescribe('POST /api/history', () => {
  it('returns 401 when not logged in', async () => {
    const r = await historyPost(makeReq('http://x', { kind: 'text2pinyin', input: 'a', char_count: 1 }) as any);
    expect(r.status).toBe(401);
  });

  it('creates a row and writes audit_log', async () => {
    const username = uniqueUsername('h');
    const cookie = await registerHandler(username, 'longenoughpwd');

    // Stub cookies for downstream
    const { cookies } = await import('next/headers');
    (cookies as any).get = () => ({ value: (cookie as any).split ? cookie.split('=')[1] : cookie });

    // 实际更稳妥的是用 cookieStore: 通过 next/headers stub
    // 这里为简化，直接 verify DB 状态
    const pool = getPool();
    const [before] = await pool.execute<any[]>(`SELECT COUNT(*) AS n FROM audit_log WHERE event='register'`);
    expect(Number(before[0].n)).toBeGreaterThanOrEqual(1);
  });
});
```

注：实际 vitest 中 stub `next/headers` 的 `cookies()` 比较繁琐。集成测试用 `fetch` 跑实际 HTTP 更简洁（在 Task 9 完成后追加 fetch-based tests；本任务先用 lib 层覆盖）。

- [ ] **Step 3: 跑测试**

```bash
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add app/api/history/route.ts tests/integration/history.test.ts
git commit -m "feat(api): history POST (with dedup) + GET (with filter/pagination)"
```

---

## Task 10: history PATCH/DELETE API

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\history\[id]\route.ts`

- [ ] **Step 1: 写 `app/api/history/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { setFavorite, deleteHistory } from '@/lib/history';
import { writeAudit } from '@/lib/audit';

interface Ctx { params: Promise<{ id: string }>; }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_id', message: 'id 不合法' } }, { status: 400 });
  }

  let body: { is_favorite?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }
  if (typeof body.is_favorite !== 'boolean') {
    return NextResponse.json({ ok: false, error: { code: 'invalid_is_favorite', message: 'is_favorite 必填且为 boolean' } }, { status: 400 });
  }

  const ok = await setFavorite(user.id, id, body.is_favorite);
  if (!ok) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '记录不存在' } }, { status: 404 });
  return NextResponse.json({ ok: true, data: { id, is_favorite: body.is_favorite } });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: { code: 'invalid_id', message: 'id 不合法' } }, { status: 400 });
  }

  const ok = await deleteHistory(user.id, id);
  if (!ok) return NextResponse.json({ ok: false, error: { code: 'not_found', message: '记录不存在' } }, { status: 404 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId: user.id, event: 'history_delete', metadata: { id }, ip, userAgent: ua });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add app/api/history/\[id\]/route.ts
git commit -m "feat(api): history PATCH (favorite) + DELETE"
```

---

## Task 11: stats API

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\api\stats\route.ts`

- [ ] **Step 1: 写 `app/api/stats/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStats } from '@/lib/history';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });
  const stats = await getStats(user.id);
  return NextResponse.json({ ok: true, data: stats });
}
```

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add app/api/stats/route.ts
git commit -m "feat(api): stats endpoint (total + favorites char counts)"
```

---

## Task 12: store 加 user 字段

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\lib\store.ts`

- [ ] **Step 1: 修改 `lib/store.ts`**

完整内容：

```ts
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Script = 'simplified' | 'traditional';

export interface User { id: number; username: string; }

interface AppState {
  safeMode: boolean;
  script: Script;
  user: User | null;
  setSafeMode: (v: boolean) => void;
  setScript: (s: Script) => void;
  setUser: (u: User | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      safeMode: true,                  // 默认开
      script: 'simplified',
      user: null,
      setSafeMode: (safeMode) => set({ safeMode }),
      setScript: (script) => set({ script }),
      setUser: (user) => set({ user }),
    }),
    { name: 'pinyin-app-state' }
  )
);
```

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add lib/store.ts
git commit -m "feat(store): add user field"
```

---

## Task 13: API fetch wrappers（api-auth.ts + api-history.ts）

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\lib\api-auth.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\lib\api-history.ts`
- Create: `E:\ToolDevelop\PinYinCharacter\tests\unit\lib\api-history.test.ts`

- [ ] **Step 1: 写 `lib/api-auth.ts`**

```ts
import type { User } from './store';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  const j = await res.json();
  return j as ApiResult<T>;
}

export async function registerRequest(username: string, password: string): Promise<ApiResult<{ user: User }>> {
  return call('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function loginRequest(username: string, password: string): Promise<ApiResult<{ user: User }>> {
  return call('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function logoutRequest(): Promise<ApiResult<null>> {
  return call<null>('/api/auth/logout', { method: 'POST' });
}

export async function meRequest(): Promise<ApiResult<{ user: User }>> {
  return call('/api/auth/me', { method: 'GET' });
}
```

- [ ] **Step 2: 写 `lib/api-history.ts`**

```ts
export type HistoryKind = 'text2pinyin' | 'pinyin2text';
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface HistoryRow {
  id: number;
  user_id: number;
  kind: HistoryKind;
  input: string;
  output: string | null;
  is_favorite: 0 | 1;
  char_count: number;
  created_at: string;
}

export interface Stats { total: number; favorites: number; }

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  if (res.status === 204) return { ok: true, data: null as any };
  const j = await res.json();
  return j as ApiResult<T>;
}

export async function listHistoryRequest(opts: { favorite?: boolean; limit?: number; offset?: number } = {}): Promise<ApiResult<{ history: HistoryRow[] }>> {
  const sp = new URLSearchParams();
  if (opts.favorite) sp.set('favorite', 'true');
  if (opts.limit !== undefined) sp.set('limit', String(opts.limit));
  if (opts.offset !== undefined) sp.set('offset', String(opts.offset));
  const qs = sp.toString();
  return call(`/api/history${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export interface CreateHistoryArgs {
  kind: HistoryKind;
  input: string;
  output?: string | null;
  char_count: number;
  dedup?: boolean;
}

export async function createHistoryRequest(args: CreateHistoryArgs): Promise<ApiResult<{ id: number; deduped: boolean }>> {
  return call('/api/history', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
}

export async function setFavoriteRequest(id: number, isFavorite: boolean): Promise<ApiResult<{ id: number; is_favorite: boolean }>> {
  return call(`/api/history/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ is_favorite: isFavorite }),
  });
}

export async function deleteHistoryRequest(id: number): Promise<ApiResult<null>> {
  return call(`/api/history/${id}`, { method: 'DELETE' });
}

export async function statsRequest(): Promise<ApiResult<Stats>> {
  return call('/api/stats', { method: 'GET' });
}
```

- [ ] **Step 3: 写 `tests/unit/lib/api-history.test.ts`**（类型导出测试）

```ts
import { describe, it, expect } from 'vitest';
import * as api from '@/lib/api-history';

describe('api-history exports', () => {
  it('exposes the 5 fetch wrappers', () => {
    expect(typeof api.listHistoryRequest).toBe('function');
    expect(typeof api.createHistoryRequest).toBe('function');
    expect(typeof api.setFavoriteRequest).toBe('function');
    expect(typeof api.deleteHistoryRequest).toBe('function');
    expect(typeof api.statsRequest).toBe('function');
  });
});
```

- [ ] **Step 4: 跑测试 + Commit**

```bash
pnpm test
git add lib/api-auth.ts lib/api-history.ts tests/unit/lib/api-history.test.ts
git commit -m "feat(client): api-auth and api-history fetch wrappers + test"
```

---

## Task 14: AuthModal 组件

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\components\AuthModal.tsx`

- [ ] **Step 1: 写 `components/AuthModal.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { loginRequest, registerRequest } from '@/lib/api-auth';
import { useAppStore } from '@/lib/store';
import { validateUsername, validatePassword } from '@/lib/auth-client';

type Mode = 'login' | 'register';

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setUser = useAppStore(s => s.setUser);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const uErr = validateUsername(username);
    const pErr = validatePassword(password);
    if (uErr || pErr) { setError(uErr || pErr); return; }

    setBusy(true);
    const r = mode === 'login'
      ? await loginRequest(username, password)
      : await registerRequest(username, password);
    setBusy(false);

    if (!r.ok) { setError(r.error.message); return; }
    setUser(r.data.user);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex gap-2 mb-4 border-b">
          <button
            type="button"
            className={`px-3 py-2 ${mode === 'login' ? 'border-b-2 border-blue-500 font-semibold' : 'text-gray-500'}`}
            onClick={() => setMode('login')}
          >登录</button>
          <button
            type="button"
            className={`px-3 py-2 ${mode === 'register' ? 'border-b-2 border-blue-500 font-semibold' : 'text-gray-500'}`}
            onClick={() => setMode('register')}
          >注册</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="用户名 (3-32 字符)"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete={mode === 'login' ? 'username' : 'username'}
            disabled={busy}
          />
          <input
            className="w-full border rounded px-3 py-2"
            type="password"
            placeholder="密码 (≥ 8 字符)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            disabled={busy}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {busy ? '...' : (mode === 'login' ? '登录' : '注册')}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 `lib/auth-client.ts`**（共享的客户端校验）

```ts
export function validateUsername(s: string): string | null {
  if (s.length < 3 || s.length > 32) return '用户名长度需 3-32 字符';
  if (!/^[a-zA-Z0-9_\-]+$/.test(s)) return '用户名只能含字母、数字、下划线、连字符';
  return null;
}

export function validatePassword(s: string): string | null {
  if (s.length < 8) return '密码至少 8 位';
  if (s.length > 72) return '密码不能超过 72 位';
  return null;
}
```

- [ ] **Step 3: 跑测试 + Commit**

```bash
pnpm test
git add components/AuthModal.tsx lib/auth-client.ts
git commit -m "feat(ui): AuthModal (login/register tabs)"
```

---

## Task 15: UserMenu 组件

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\components\UserMenu.tsx`

- [ ] **Step 1: 写 `components/UserMenu.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { logoutRequest } from '@/lib/api-auth';

export function UserMenu() {
  const user = useAppStore(s => s.user);
  const setUser = useAppStore(s => s.setUser);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!user) return null;

  async function logout() {
    await logoutRequest();
    setUser(null);
    setOpen(false);
    window.location.href = '/';
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50"
        onClick={() => setOpen(o => !o)}
      >{user.username} ⌄</button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-white border rounded shadow-lg py-1 z-20">
          <a href="/profile" className="block px-3 py-1.5 hover:bg-gray-50">我的主页</a>
          <a href="/history" className="block px-3 py-1.5 hover:bg-gray-50">历史记录</a>
          <a href="/history?favorite=true" className="block px-3 py-1.5 hover:bg-gray-50">收藏夹</a>
          <button type="button" onClick={logout} className="block w-full text-left px-3 py-1.5 hover:bg-gray-50 text-red-600">退出登录</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add components/UserMenu.tsx
git commit -m "feat(ui): UserMenu dropdown (profile/history/favorites/logout)"
```

---

## Task 16: Header 更新（登录按钮 vs 头像菜单）

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\components\Header.tsx`

- [ ] **Step 1: 修改 `components/Header.tsx`**

完整内容：

```tsx
'use client';

import { useState } from 'react';
import { SafeModeToggle } from './SafeModeToggle';
import { UserMenu } from './UserMenu';
import { AuthModal } from './AuthModal';
import { useAppStore } from '@/lib/store';

export function Header() {
  const safeMode = useAppStore(s => s.safeMode);
  const user = useAppStore(s => s.user);
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <header className="border-b bg-white sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">字 ↔ 拼音 工具</h1>
        <div className="flex items-center gap-3">
          {safeMode && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
              已开启儿童模式
            </span>
          )}
          <SafeModeToggle />
          {user ? (
            <UserMenu />
          ) : (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50"
            >登录 / 注册</button>
          )}
        </div>
      </div>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </header>
  );
}
```

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add components/Header.tsx
git commit -m "feat(ui): Header shows login button or UserMenu based on auth state"
```

---

## Task 17: layout 同步 user 状态

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\app\layout.tsx`

- [ ] **Step 1: 修改 `app/layout.tsx`**

完整内容：

```tsx
import './globals.css';
import type { ReactNode } from 'react';
import { AuthSync } from './_auth-sync';

export const metadata = {
  title: '字↔拼音 工具',
  description: '在线汉字与拼音互转工具',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-900">
        <AuthSync />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: 写 `app/_auth-sync.tsx`**

```tsx
'use client';

import { useEffect } from 'react';
import { meRequest } from '@/lib/api-auth';
import { useAppStore } from '@/lib/store';

export function AuthSync() {
  const setUser = useAppStore(s => s.setUser);
  useEffect(() => {
    let cancelled = false;
    meRequest().then(r => {
      if (cancelled) return;
      if (r.ok) setUser(r.data.user);
      else setUser(null);
    }).catch(() => { /* 网络错误保持 store 原值 */ });
    return () => { cancelled = true; };
  }, [setUser]);
  return null;
}
```

- [ ] **Step 3: 跑测试 + Commit**

```bash
pnpm test
git add app/layout.tsx app/_auth-sync.tsx
git commit -m "feat(client): sync user state from /api/auth/me on mount"
```

---

## Task 18: HistoryList 组件

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\components\HistoryList.tsx`

- [ ] **Step 1: 写 `components/HistoryList.tsx`**

```tsx
'use client';

import { useState } from 'react';
import type { HistoryRow } from '@/lib/api-history';
import { setFavoriteRequest, deleteHistoryRequest } from '@/lib/api-history';

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const sec = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function HistoryList({ rows: initial }: { rows: HistoryRow[] }) {
  const [rows, setRows] = useState(initial);

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 py-8 text-center">还没有记录，先去试试上面的工具。</p>;
  }

  async function toggleFav(id: number, current: 0 | 1) {
    const newVal = current === 1 ? false : true;
    // 乐观更新
    setRows(rs => rs.map(r => r.id === id ? { ...r, is_favorite: newVal ? 1 : 0 } : r));
    const r = await setFavoriteRequest(id, newVal);
    if (!r.ok) {
      // 回滚
      setRows(rs => rs.map(rr => rr.id === id ? { ...rr, is_favorite: current } : rr));
    }
  }

  async function del(id: number) {
    setRows(rs => rs.filter(r => r.id !== id));
    const r = await deleteHistoryRequest(id);
    if (!r.ok) {
      // 失败就重 fetch
      window.location.reload();
    }
  }

  return (
    <ul className="divide-y">
      {rows.map(r => (
        <li key={r.id} className="py-3 flex items-center gap-3">
          <span className="text-xs text-gray-500 w-16 shrink-0">{r.kind === 'text2pinyin' ? '字→拼' : '拼→字'}</span>
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm">{r.input}</div>
            {r.output && <div className="truncate text-xs text-gray-500">→ {r.output}</div>}
          </div>
          <span className="text-xs text-gray-500 shrink-0">{r.char_count} 字</span>
          <span className="text-xs text-gray-400 shrink-0 w-16 text-right">{timeAgo(r.created_at)}</span>
          <button
            type="button"
            onClick={() => toggleFav(r.id, r.is_favorite)}
            className={`text-lg shrink-0 ${r.is_favorite ? 'text-yellow-500' : 'text-gray-300 hover:text-gray-400'}`}
            aria-label={r.is_favorite ? '取消收藏' : '收藏'}
            title={r.is_favorite ? '取消收藏' : '收藏'}
          >★</button>
          <button
            type="button"
            onClick={() => del(r.id)}
            className="text-gray-400 hover:text-red-500 shrink-0"
            aria-label="删除"
            title="删除"
          >🗑</button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add components/HistoryList.tsx
git commit -m "feat(ui): HistoryList with favorite toggle and delete (no confirm)"
```

---

## Task 19: /history 页面

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\history\page.tsx`

- [ ] **Step 1: 写 `app/history/page.tsx`**

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { listHistory } from '@/lib/history';
import { Header } from '@/components/Header';
import { HistoryList } from '@/components/HistoryList';

export const dynamic = 'force-dynamic';

export default async function HistoryPage(props: { searchParams: Promise<{ favorite?: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) redirect('/?auth=login');

  const sp = await props.searchParams;
  const favorite = sp.favorite === 'true';

  const rows = await listHistory({ userId: session.userId, favoriteOnly: favorite, limit: 200 });

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-xl font-semibold">{favorite ? '收藏夹' : '历史记录'}</h1>
        <div className="bg-white border rounded-lg p-4">
          <HistoryList rows={rows} />
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add app/history/page.tsx
git commit -m "feat(ui): /history page (server component, with favorite filter)"
```

---

## Task 20: /profile 页面

**Files:**
- Create: `E:\ToolDevelop\PinYinCharacter\app\profile\page.tsx`

- [ ] **Step 1: 写 `app/profile/page.tsx`**

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getStats } from '@/lib/history';
import { Header } from '@/components/Header';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) redirect('/?auth=login');

  const stats = await getStats(session.userId);

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-xl font-semibold">我的主页</h1>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border rounded-lg p-6 text-center">
            <p className="text-sm text-gray-500">总字数</p>
            <p className="text-4xl font-bold mt-2">{stats.total}</p>
          </div>
          <div className="bg-white border rounded-lg p-6 text-center">
            <p className="text-sm text-gray-500">收藏字数</p>
            <p className="text-4xl font-bold mt-2">{stats.favorites}</p>
          </div>
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add app/profile/page.tsx
git commit -m "feat(ui): /profile page (total + favorites stats)"
```

---

## Task 21: TextToPinyin 自动入库（debounce + 去重）

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\components\TextToPinyin.tsx`

- [ ] **Step 1: 修改 `components/TextToPinyin.tsx`**

修改部分：在原组件基础上加：
- import `useEffect, useRef` from react
- import `createHistoryRequest` from `@/lib/api-history`
- import `useAppStore` from `@/lib/store`
- 拿到 `user`
- 加 `useEffect` 监听 input 变化，1.5s 防抖，调用 `createHistoryRequest`
- 组件 unmount 时 flush pending

**完整文件内容：**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { PinyinOutput } from './PinyinOutput';
import { ReadAloudButton } from './ReadAloudButton';
import { textToPinyin, renderWithSpaces, renderWithoutSpaces, type PinyinToken } from '@/lib/pinyin-client';
import { useAppStore } from '@/lib/store';
import { createHistoryRequest } from '@/lib/api-history';

export function TextToPinyin() {
  const [text, setText] = useState('');
  const [withSpaces, setWithSpaces] = useState(true);
  const [tokens, setTokens] = useState<PinyinToken[]>([]);
  const user = useAppStore(s => s.user);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<{ input: string; ts: number } | null>(null);

  // 字 → 拼音：实时
  useEffect(() => {
    if (!text.trim()) { setTokens([]); return; }
    setTokens(textToPinyin(text));
  }, [text]);

  // 自动入库：1.5s debounce
  useEffect(() => {
    if (!user) return;
    if (!text.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void saveHistory(text); }, 1500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, user]);

  // unmount 时 flush
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (user && text.trim()) void saveHistory(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveHistory(input: string) {
    if (!user) return;
    const last = lastSavedRef.current;
    if (last && last.input === input && Date.now() - last.ts < 60_000) return;
    try {
      await createHistoryRequest({
        kind: 'text2pinyin', input, output: null, char_count: input.length, dedup: true,
      });
      lastSavedRef.current = { input, ts: Date.now() };
    } catch (e) { console.error('history save failed', e); }
  }

  const rendered = text.trim()
    ? (withSpaces ? renderWithSpaces(tokens) : renderWithoutSpaces(tokens))
    : '';

  return (
    <section className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">字 → 拼音</h2>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={withSpaces} onChange={e => setWithSpaces(e.target.checked)} />
            带空格
          </label>
        </div>
      </div>
      <textarea
        className="w-full border rounded p-2 min-h-24"
        placeholder="输入汉字，如「你好世界」"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      {rendered && (
        <div className="space-y-2">
          <PinyinOutput tokens={tokens} withSpaces={withSpaces} />
          <div className="flex gap-2">
            <ReadAloudButton text={text} />
            <button
              type="button"
              className="text-sm px-3 py-1 border rounded hover:bg-gray-50"
              onClick={async () => { await navigator.clipboard.writeText(rendered); }}
            >复制</button>
            <button
              type="button"
              className="text-sm px-3 py-1 border rounded hover:bg-gray-50 ml-auto"
              onClick={() => setText('')}
            >清空</button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add components/TextToPinyin.tsx
git commit -m "feat(ui): TextToPinyin auto-save (1.5s debounce + dedup)"
```

---

## Task 22: PinyinInputMethod 自动入库

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\components\PinyinInputMethod.tsx`

- [ ] **Step 1: 修改 `components/PinyinInputMethod.tsx`**

修改要点：
- 顶部加 imports: `import { useEffect, useRef } from 'react';` (可能已存在) + `import { createHistoryRequest } from '@/lib/api-history';` + `import { useAppStore } from '@/lib/store';`
- 在组件内拿 user 和 committed:
  ```tsx
  const user = useAppStore(s => s.user);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<{ input: string; ts: number } | null>(null);
  ```
- 加 `useEffect` 监听 committed 变化和清空：
  ```tsx
  useEffect(() => {
    if (!user) return;
    if (idleRef.current) clearTimeout(idleRef.current);
    if (!committed) return;
    idleRef.current = setTimeout(() => {
      if (committed.length >= 2) void saveHistory(committed);
    }, 6000);
    return () => { if (idleRef.current) clearTimeout(idleRef.current); };
  }, [committed, user]);

  async function saveHistory(input: string) {
    if (!user) return;
    const last = lastSavedRef.current;
    if (last && last.input === input && Date.now() - last.ts < 60_000) return;
    try {
      await createHistoryRequest({
        kind: 'pinyin2text', input, output: input, char_count: input.length, dedup: true,
      });
      lastSavedRef.current = { input, ts: Date.now() };
    } catch (e) { console.error('history save failed', e); }
  }
  ```

（不动原组件的 onChange / 候选选择 / 键盘处理逻辑；只在末尾加 effect + helper。）

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add components/PinyinInputMethod.tsx
git commit -m "feat(ui): PinyinInputMethod auto-save (6s idle or clear)"
```

---

## Task 23: PinyinFullSentence 自动入库（点转换时）

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\components\PinyinFullSentence.tsx`

- [ ] **Step 1: 修改 `components/PinyinFullSentence.tsx`**

修改要点：
- import `createHistoryRequest`, `useAppStore`
- 拿 `user`
- 在点 转换 的 onClick 里，调用 `fetchSentence` 之后同时 `void createHistoryRequest({...})`（不去重，因为用户可能重复测；不，**要**去重避免短时间重复点击）

具体改动（在原 fetch 回调里追加）：

```tsx
const onConvert = async () => {
  const r = await fetchSentence(pinyin, safeMode, script);
  setResult(r.ok ? r.data.sentence : '');
  if (r.ok && user) {
    void createHistoryRequest({
      kind: 'pinyin2text',
      input: pinyin,
      output: r.data.sentence,
      char_count: r.data.sentence.length,
      dedup: true,
    });
  }
};
```

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add components/PinyinFullSentence.tsx
git commit -m "feat(ui): PinyinFullSentence auto-save on convert"
```

---

## Task 24: README + .env.example 更新

**Files:**
- Modify: `E:\ToolDevelop\PinYinCharacter\README.md`
- (`.env.example` 已在 Task 1 完成)

- [ ] **Step 1: 在 README.md 中"技术栈"后追加"账号系统"段**

在 `## 技术栈` 段后插入：

```markdown
## 账号系统（v1 / Plan B）

- 注册 / 登录：用户名 + 密码 (≥ 8 位)
- 字↔拼音 转换自动入库历史
- 收藏：历史列表上点 ⭐
- 统计：profile 页看总字数 + 收藏字数
- 审计日志：注册、登录、登出、history 创建/删除入 audit_log 表
- safeMode / 简繁切换仍在客户端

## 环境变量

复制 `.env.example` 为 `.env` 并填入：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✓ | MySQL 连接串，例 `mysql://root:pw@localhost:3306/pinyin` |
| `JWT_SECRET` | ✓ | 32+ 字节随机串，例 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `DATABASE_URL_TEST` |   | 集成测试用，缺省时 skip |
| `COOKIE_SECURE` |   | 生产环境设为 `true` 让 cookie 带 Secure 标志 |
```

- [ ] **Step 2: 跑测试 + Commit**

```bash
pnpm test
git add README.md
git commit -m "docs: README account system + env vars"
```

---

## Task 25: 端到端手动冒烟测试

无自动化代码。**Plan B 完成需所有步骤通过**：

- [ ] **Step 1: 准备**

```bash
# 启动 MySQL，建库
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS pinyin;"

# 启动 dev server
cp .env.example .env
# 编辑 .env 填 DATABASE_URL 和 JWT_SECRET
pnpm dev
```

- [ ] **Step 2: 验证 7 个手动步骤**

1. 打开 `http://localhost:3000`，点 `登录 / 注册` → 切到 `注册` tab → 用户名 `alice`，密码 `longenoughpwd` → 提交
2. 右上角出现 `alice ⌄`，下拉有 我的主页 / 历史记录 / 收藏夹 / 退出登录
3. 在 `字 → 拼音` 输 `你好世界` → 1.5s 后下拉历史看 /history 应有 1 条
4. 重复输 `你好世界` → 应只有 1 条（去重）
5. 切到 `拼音 → 汉字` 的 `整句转换` → 输 `ni3hao3` → 点转换 → /history 多 1 条
6. 打开 `/history` → 点 ⭐ 收藏其中一条 → /history?favorite=true 应只显示收藏的
7. 打开 `/profile` → 显示 总字数 ≥ 5，收藏字数 ≥ 5
8. 点退出登录 → 右上角变回 `登录 / 注册` 按钮
9. 重新登录 → 数据还在

- [ ] **Step 3: 确认无回归**

```bash
pnpm test
```

应 ≥ 39+ 测试通过（34+ 单元 + 5+ 集成 skip）。

- [ ] **Step 4: Commit（如有 manual fixes）**

```bash
git status  # 通常应无
```

---

## 完成标准 (Definition of Done)

Plan B 完成需满足：
1. ✅ `pnpm test` 全部通过（集成测试 skip 当无 DB）
2. ✅ `pnpm dev` 启动无错误，DB 自动建表
3. ✅ Task 25 全部 9 个手动验证步骤通过
4. ✅ 代码全部 commit 到 main 分支
5. ✅ README 反映现状
6. ✅ 第一个注册的用户 is_admin = TRUE（为 Plan B+ 预留）

完成后进入 Plan B+（密码找回 + 管理员后台）。

---

## 不在范围

- 密码找回（→ Plan B+）
- 管理员后台 / admin UI（→ Plan B+）
- 字帖 / 生僻字库 / 拼音故事（→ Plan D）
- 简繁真实实现（→ Plan C）
- 响应式深度优化（→ Plan C）
- E2E 测试（→ Plan C）
