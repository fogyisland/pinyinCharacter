# 字典 level 筛选 + 右键追加到「我的字帖」 + 详情页 + JSON 解析修复 — 设计

## Context

字典页面(`/dictionary`)目前:
1. 没有 level 筛选 UI — 但后端 `listChars({ level })` 已支持,URL 传 `?level=1` 也能用,只是没暴露给用户
2. 字符格是 server 渲染的 `<Link>`,无法触发右键菜单
3. 详情页 (`/dictionary/<char>`) 上的「+ 字帖」是 `<Link>`,跳到 `/worksheet?text=...`,而不是直接 append

字源 (`/etymology/<char>`) 和故事 (`/stories/<char>`) 页面 404,因为:
- `getEtymology` 要求 `char_etymology` 表里有一行,大多数字(2026-06-17 slim migration 后)只有 JSON content
- `getChar` (故事页用的) 读 `rare_chars` 表,大多数字没有 `rare_chars` 行

用户希望:
1. 字典页加 level 切换(全部 / 一级 / 二级 / 三级)
2. 字符格右键 → 一项菜单「添加到我的字帖」→ 单字追加到一个属于当前用户的 worksheet 标题固定为「我的字帖」
3. 详情页「+ 字帖」改成内联按钮,不跳页
4. `/etymology/<char>` 从 JSON 读 etymology_story,不再 404
5. `/stories/<char>` 从 JSON 读 hanzi_story,不再 404

## Goals

- 字典加 level 切换,跟现有「按拼音/按部首」正交
- 右键追加走专用 endpoint,append 到每用户唯一的「我的字帖」(有就追加,没就建)
- 反馈用全局 toast(新增基础设施),anonymous 用户也能看到菜单但 API 返 401 时给提示
- 已存在的字不重复加,直接 toast「已存在」
- 详情页「+ 字帖」inline 按钮直接调用同一 endpoint,不走跳转
- 字源 / 故事 页面 JSON-first,DB 仅作 legacy fallback
- 让 slim-migration 后没 DB 行的字也能正常访问字源和故事页面

## Non-Goals

- 不做 worksheet 多选 UI(本次每用户只有一个「我的字帖」)
- 不做「我的字帖」删除/重命名(用户可在 `/worksheet` history 页删整条)
- 不做并发安全 DB 约束(下文风险部分说明)
- 不做移动端长按弹出菜单(只桌面右键)
- 不动其它页面的右键行为
- 不做字源 / 故事页面的全新 UI 重设计 — 只改数据读取路径,渲染层尽量不动
- 不迁移旧的 `char_story` 表(已 drop)

## 设计

### 1. 字典 level 筛选

**`components/dictionary/DictionaryClient.tsx`** 在现有「按拼音 / 按部首」切换按钮旁加一组 level 切换:`全部 · 一级 · 二级 · 三级`。URL 参数 `?level=1|2|3`,不传 = 全部(已存在行为)。

切换器是一个 4 按钮 group(用一个 `level` state 渲染 active),URL 同步逻辑复用现有 `switchView` 的模式 — 用 `URLSearchParams.set/delete` 然后 `router.push`。

`app/dictionary/page.tsx` 不用动 — 已经 `level: sp.level ? Number(sp.level) as 1|2|3 : undefined` 传给 `listChars`。

样式沿用现有 view 切换(`bg-ink text-paper` 选中态),顺序:「全部 一级 二级 三级」(全部靠左,符合中文 UI 习惯)。

### 2. 右键菜单 — DictionaryCharGrid client 化

**新文件 `components/dictionary/DictionaryCharGridClient.tsx`**('use client'): 接收 `chars: Char[]` 跟原 `DictionaryCharGrid` 一样渲染 `<Link>` 网格,但每个 link 加 `onContextMenu={handleCtxMenu}`。

**`components/dictionary/DictionaryCharGrid.tsx`** 改为薄壳:`export function DictionaryCharGrid(props) { return <DictionaryCharGridClient {...props} /> }`。保持 server-friendly 的 type 表面。

**`components/dictionary/CharContextMenu.tsx`**('use client',固定定位):
- props: `{ x: number; y: number; char: string; onClose: () => void }`
- 单一项:`添加到「我的字帖」`
- `position: fixed; left: x; top: y; z-index: 50`,深色背 + 浅色 hover
- 监听 `document click` + `Escape` keydown → `onClose`
- `useEffect` 注册 + 清理,unmount 自动解绑

**触发流程** (`DictionaryCharGridClient`):
```ts
const [menu, setMenu] = useState<{x,y,char} | null>(null);
const onContextMenu = (e: React.MouseEvent, c: string) => {
  e.preventDefault();
  setMenu({ x: e.clientX, y: e.clientY, char: c });
};
// 渲染:网格 + {menu && <CharContextMenu {...menu} onClose={() => setMenu(null)} />}
```

### 3. 后端 — `POST /api/worksheets/append`

**新文件 `lib/worksheet-append.ts`**(server-only,server actions OR 路由调用):

```ts
const MY_WORKSHEET_TITLE = '我的字帖';
const DEFAULT_CELL_STYLE = 'brush';
const DEFAULT_PAPER_SIZE = 'A4';
const DEFAULT_FONT_FAMILY = 'song';

export interface AppendResult {
  worksheetId: number;
  added: boolean; // true = 新加,false = 已存在
}

export async function appendCharToMyWorksheet(userId: number, char: string): Promise<AppendResult> {
  const pool = getPool();

  // 1) 找现有
  const [rows] = await pool.query<any[]>(
    `SELECT id, content FROM worksheets WHERE user_id = ? AND title = ? LIMIT 1`,
    [userId, MY_WORKSHEET_TITLE]
  );

  if (rows.length === 0) {
    // 2a) 创建
    const [ins] = await pool.execute<any>(
      `INSERT INTO worksheets (user_id, title, content, cell_style, paper_size, font_family)
       VALUES (?, ?, JSON_ARRAY(?), ?, ?, ?)`,
      [userId, MY_WORKSHEET_TITLE, char, DEFAULT_CELL_STYLE, DEFAULT_PAPER_SIZE, DEFAULT_FONT_FAMILY]
    );
    return { worksheetId: ins.insertId, added: true };
  }

  const worksheet = rows[0];
  const content: string[] = typeof worksheet.content === 'string'
    ? JSON.parse(worksheet.content)
    : worksheet.content;
  if (content.includes(char)) {
    return { worksheetId: worksheet.id, added: false };
  }

  // 2b) 追加
  await pool.execute<any>(
    `UPDATE worksheets SET content = JSON_ARRAY_APPEND(content, '$', ?) WHERE id = ?`,
    [char, worksheet.id]
  );
  return { worksheetId: worksheet.id, added: true };
}
```

**新文件 `app/api/worksheets/append/route.ts`** POST handler:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { appendToWorksheetSchema } from '@/lib/validators';
import { appendCharToMyWorksheet } from '@/lib/worksheet-append';
import { logUserAction } from '@/lib/audit';

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const body = await req.json();
    const parsed = appendToWorksheetSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    }
    const result = await appendCharToMyWorksheet(user.id, parsed.data.char);
    await logUserAction(req, user.id, 'worksheet_char_appended', {
      worksheetId: result.worksheetId,
      char: parsed.data.char,
      added: result.added,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}
```

**`lib/validators.ts`** 新增(复用现成 `SINGLE_CJK`):

```ts
export const appendToWorksheetSchema = z.object({
  char: z
    .string()
    .refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s), {
      error: 'must be a single CJK char',
    }),
});
```

**`lib/audit-format.ts`** 加新事件 `worksheet_char_appended` 到 `AuditEvent` union,并加 formatLogMessage 分支:

```ts
case 'worksheet_char_appended':
  return `${m.added === false ? '已存在' : '追加'}「${str(m.char) || '?'}」到「我的字帖」 (#${num(m.worksheetId) || '?'})`;
```

### 4. 全局 toast 基础设施

**新文件 `lib/toast-store.ts`**('use client',zustand,无 persist — 临时提示不需要持久):

```ts
import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast { id: number; kind: ToastKind; text: string; }

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, text) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    if (typeof window !== 'undefined') {
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3000);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
```

**新文件 `components/common/Toast.tsx`**('use client'):
- `<ToastViewport>`: 订阅 `useToastStore`,`position: fixed; bottom: 24px; right: 24px; z-index: 100`
- 每条 toast:`<div>` 圆角 + 浅深色背景(success=绿,error=红,info=灰),× 关闭按钮(可选用 `dismiss`)
- 全局只挂一个,在 `app/layout.tsx` body 内、children 后

**`app/layout.tsx`**: 在 `{children}` 后加 `<ToastViewport />`。

### 5. 前端 helper + 客户端 wiring

**`lib/api-worksheet.ts`** 加:

```ts
export async function appendCharToMyWorksheetApi(char: string): Promise<{ worksheetId: number; added: boolean }> {
  const res = await fetch('/api/worksheets/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ char }),
  });
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'add failed';
    throw new Error(msg);
  }
  return data.data;
}
```

**`components/dictionary/DictionaryCharGridClient.tsx`** 调用:

```ts
const toast = useToastStore((s) => s.push);

const handleAdd = async (char: string) => {
  try {
    const { added } = await appendCharToMyWorksheetApi(char);
    toast(added ? 'success' : 'info', added ? `已添加「${char}」到「我的字帖」` : `「${char}」已经在「我的字帖」里了`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('login')) {
      toast('error', '请先登录后再添加');
    } else {
      toast('error', '添加失败,请重试');
    }
  }
};
```

错误识别:API handler 用 `unauthorized()` 返 401,client 看 `res.ok === false` 抛的 message 里 'unauthorized' / 'Unauthorized' / 状态码不行 — 改用 `res.status === 401` 显式判断更稳:

```ts
export async function appendCharToMyWorksheetApi(char: string): Promise<{ worksheetId: number; added: boolean }> {
  const res = await fetch('/api/worksheets/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ char }),
  });
  if (res.status === 401) {
    throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
  }
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'add failed';
    throw new Error(msg);
  }
  return data.data;
}
```

client catch:
```ts
if (e instanceof Error && 'code' in e && (e as any).code === 'unauthorized') {
  toast('error', '请先登录后再添加');
} else { ... }
```

### 6. 详情页 inline +字帖 按钮

**新文件 `components/dictionary/DictionaryDetailAddToWorksheet.tsx`**('use client'):

```tsx
'use client';
import { useState } from 'react';
import { useToastStore } from '@/lib/toast-store';
import { appendCharToMyWorksheetApi } from '@/lib/api-worksheet';

export function DictionaryDetailAddToWorksheet({ char }: { char: string }) {
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    try {
      const { added } = await appendCharToMyWorksheetApi(char);
      push(added ? 'success' : 'info', added ? `已添加「${char}」到「我的字帖」` : `「${char}」已经在「我的字帖」里了`);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'unauthorized') {
        push('error', '请先登录后再添加');
      } else {
        push('error', '添加失败,请重试');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button onClick={onClick} disabled={busy} className="px-3 py-2 text-sm text-ink-soft hover:text-ink disabled:opacity-50">
      {busy ? '添加中…' : '+ 字帖'}
    </button>
  );
}
```

**修改 `components/dictionary/DictionaryDetailTabs.tsx`**: 把

```tsx
<Link href={`/worksheet?text=${encodeURIComponent(char.char)}`} className="...">+ 字帖</Link>
```

替换为

```tsx
<DictionaryDetailAddToWorksheet char={char.char} />
```

不再跳页,跟右键菜单共用同一 API + toast 反馈路径。

### 7. `/etymology/<char>` 不再 404 — JSON 优先

**修改 `lib/etymology.ts`**: 当前 `getEtymology` 在 `char_etymology` 表没行时直接 return null → 页面 404。2026-06-17 slim migration 后大部分字没有该行,但 JSON 里有 `etymology.story`。

新行为: 表没行时,如果 `data/content/<char>.json` 有 `etymology.story`,返回一个 minimal record (eraGlyphs 全 false,story 来自 JSON);都没有才 return null。

```ts
if (rows.length === 0) {
  const contentOnly = await getContent(char);
  const storyOnly = contentOnly?.etymology?.story ?? null;
  if (!storyOnly) return null;
  return {
    char,
    eraGlyphs: ERAS.map((era) => ({ era, font: '', hasGlyph: false })),
    story: storyOnly,
    generatedBy: contentOnly?.etymology?.generated_by ?? null,
    generatedAt: contentOnly?.etymology?.generated_at ?? null,
  };
}
```

`EtymologyTimeline` 组件不用改 — 已有 eraGlyphs 空渲染 + story 区块渲染路径。

### 8. `/stories/<char>` 不再 404 — JSON 优先

**新文件 `lib/story.ts`**(server-only):

```ts
import 'server-only';
import { getPool } from './db';
import { getContent } from './content';

export interface HanziStory {
  char: string;
  story: string;
  pinyin?: string;
}

export async function getHanziStory(char: string): Promise<HanziStory | null> {
  const content = await getContent(char);
  if (content?.hanzi_story) {
    return { char: content.char, story: content.hanzi_story, pinyin: content.pinyin };
  }
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, pinyin, story FROM rare_chars WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  if (rows.length === 0 || !rows[0].story) return null;
  return { char: rows[0].char, story: rows[0].story, pinyin: rows[0].pinyin };
}
```

**修改 `app/stories/[char]/page.tsx`**: 用 `getHanziStory` 替换 `getChar`。`StoryClient` 的 props 形态需要适配 — 在写代码前先 `Read app/stories/StoryClient.tsx` 看它读哪些字段,做一个小的 inline adapter(类型上 `as any` 接受,HanziStory 子集够用)。

## 文件清单

**新建:**
- `lib/worksheet-append.ts`
- `app/api/worksheets/append/route.ts`
- `lib/toast-store.ts`
- `components/common/Toast.tsx`(含 `ToastViewport`)
- `components/dictionary/CharContextMenu.tsx`
- `components/dictionary/DictionaryCharGridClient.tsx`
- `components/dictionary/DictionaryDetailAddToWorksheet.tsx`
- `lib/story.ts`
- `tests/unit/lib/worksheet-append.test.ts`
- `tests/integration/api/worksheets-append.test.ts`

**修改:**
- `components/dictionary/DictionaryClient.tsx` — 加 level 切换按钮
- `components/dictionary/DictionaryCharGrid.tsx` — 改为薄壳 wrapper
- `components/dictionary/DictionaryDetailTabs.tsx` — `+ 字帖` Link → button
- `lib/etymology.ts` — JSON fallback 路径
- `app/stories/[char]/page.tsx` — 用 `getHanziStory`
- `lib/validators.ts` — 加 `appendToWorksheetSchema`
- `lib/audit-format.ts` — 加 `worksheet_char_appended` 到 union + formatLogMessage case
- `app/layout.tsx` — 挂 `<ToastViewport />`
- `lib/api-worksheet.ts` — 加 `appendCharToMyWorksheetApi`

## 测试

**单元 (`tests/unit/lib/worksheet-append.test.ts`):**
- `appendCharToMyWorksheet`: 首次调用创建 worksheet 并返回 `added: true`
- 第二次调用追加到同一 worksheet,`added: true`
- 同字再调用返回 `added: false`,content 不变
- 两个不同 user 各自有自己的「我的字帖」
- 异常:char 不合法 → 应在 validator 层拦,这里只测纯逻辑

**集成 (`tests/integration/api/worksheets-append.test.ts`):**
- 已登录 POST `{char:'我'}` → 200,`{worksheetId, added:true}`,DB worksheets 多一行
- 再次 POST 同 char → 200,`added:false`,DB content 不变
- POST 不同 char → 200,`added:true`,DB content 多一项(JSON order 保持 append 顺序)
- 未登录 POST → 401
- POST `{char:''}` 或 `{char:'我我'}` → 400 (validator reject)

**端到端:**
- 人类浏览器冒烟:登录 → /dictionary → 切 level → 看页数变 → 右键 → 菜单出现 → 点 → toast 出现 → 跳 /worksheet/<id> 看到新字(此步人类手动,不自动化)

## 风险

### R1:并发可能创建多个「我的字帖」

**场景:** 用户连续两次右键(基本不会,但脚本 / 自动化可能),两个 POST 并发:
- 两个都看到「没找到」 → 两个都 INSERT → 第二次追加到一个 worksheet,第一个孤立
- worksheets 表上没 `(user_id, title)` UNIQUE

**决策:** 先 ship naive 实现(简单 select-then-insert),写注释说明。在 `worksheet-append.ts` 文件顶部加一段 `// Concurrency: this is a read-then-write; under concurrent appends there's a small window where two '我的字帖' rows could be created for one user. Mitigated by the fact that all callers are browser-initiated user clicks, not bulk jobs. If observed in production, add UNIQUE(user_id, title) via migration.` 注释。**不做 DB 迁移(避免破坏现存数据)。**

### R2:`JSON_ARRAY_APPEND` 在 MySQL 5.7 对 utf8mb4 字符是否 OK

已查 MySQL 5.7 文档: JSON 函数对 utf8mb4 全支持,单字 `'我'` 在 JSON 里会以 unicode escape (`"我"`) 存储,parse 出来无信息丢失。

### R3:右键菜单在触屏 / 长按场景

桌面浏览器右键有效。移动端没有右键 — 用户不会碰到。长按(contextmenu 事件在触屏不触发)不是本次目标。如果用户后续要求,加 `onTouchStart` 长按支持(YAGNI 先不做)。

### R4:`app/layout.tsx` 加 `<ToastViewport />` 后 RSC 边界

ToastViewport 是 client component,在 server layout 引用 OK(Next.js 15 允许 client component 嵌在 server tree)。无新坑。

### R5:`/etymology/<char>` minimal-record 路径下 eraGlyphs 全 false

JSON-only 路径返回的 record 里 `eraGlyphs` 全 `hasGlyph: false`,`EtymologyTimeline` 渲染时如果没 glyph 但有 story,渲染结果应是「故事 + 空白时间线」而不是 404。**实施时需确认 `EtymologyTimeline` 在 eraGlyphs 全 false 时不 crash**(读组件源码确认;若是严格依赖每个 era 有 glyph,需放宽条件)。

### R6:`/stories/<char>` 的 `StoryClient` props 适配

`StoryClient` 当前接受 `RareCharClient` 形态的 props。`HanziStory` 是其子集(`char`, `story`, `pinyin`),其它字段它可能不读,但如果类型严格的话需要 `as any` 适配。**实施时先 Read `app/stories/StoryClient.tsx` 看它读哪些字段**,只传它读的,其它字段用 `undefined` 兜底(或 `as any`)。

## Global Constraints

- 跟 audit 审计偏好一致(每条 mutating endpoint 都走 `logUserAction`,见 `memory/user-action-audit-preference.md`)
- `lib/audit-format.ts` 跟 `lib/audit.ts` 拆分的 client-safe/server-only 边界保持(新事件加在 format,type union 用 `export type { AuditEvent } from './audit-format'`)
- 现有 `worksheets` 表 schema 不动
- 所有新文件用 UTF-8,文案中文,跟项目其它前端一致
- 不引新依赖(zustand 已在,无新增)
- 不破坏现有 worksheets API(`GET/POST /api/worksheets`,`GET/DELETE /api/worksheets/[id]`,`POST /api/worksheets/[id]/print`)

## 验证

- `pnpm tsc --noEmit` — 干净
- `pnpm build` — 干净(dev server 跑着时不要 build,先 tsc + tests)
- `pnpm test tests/unit/lib/audit.test.ts` — 全过(含新事件)
- `pnpm test tests/integration/api/worksheets-append.test.ts` — 5/5 集成全过
- `pnpm test tests/unit/lib/worksheet-append.test.ts` — **本机跳过**:`piyin_test` DB 不存在(用户决策 2026-06-18),靠集成测试 + 浏览器冒烟验证
- 浏览器人工冒烟:
  - 登录 → /dictionary 切 level → URL `?level=N` 正确
  - /dictionary 右键任意字 → 菜单 → 点 → toast 反馈
  - /dictionary/<char> → 点 `+ 字帖` 按钮 → toast 反馈,不跳页
  - /etymology/<char> → 200,显示 etymology_story
  - /stories/<char> → 200,显示 hanzi_story

## 提交

9 commits(每 task 1 个):

1. `feat(worksheet-append): server lib for find-or-create 我的字帖 + append`
2. `feat(audit): worksheet_char_appended event + appendToWorksheetSchema validator`
3. `feat(worksheets-append): POST /api/worksheets/append endpoint + integration tests`
4. `feat(toast): zustand store + ToastViewport mounted in root layout`
5. `feat(dictionary): right-click '添加到我的字帖' menu + client wiring`
6. `feat(dictionary): level filter buttons (全部/一级/二级/三级)`
7. `feat(dictionary-detail): inline +字帖 button on char page (no nav)`
8. `fix(etymology): read story from JSON when no char_etymology row (post slim-migration)`
9. `fix(stories): read hanzi_story from JSON (slim-DB path) so /stories/<char> stops 404ing`