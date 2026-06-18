# 字典 level 筛选 + 右键追加到「我的字帖」 — 设计

## Context

字典页面(`/dictionary`)目前:
1. 没有 level 筛选 UI — 但后端 `listChars({ level })` 已支持,URL 传 `?level=1` 也能用,只是没暴露给用户
2. 字符格是 server 渲染的 `<Link>`,无法触发右键菜单

用户希望:
1. 字典页加 level 切换(全部 / 一级 / 二级 / 三级)
2. 字符格右键 → 一项菜单「添加到我的字帖」→ 单字追加到一个属于当前用户的 worksheet 标题固定为「我的字帖」

## Goals

- 字典加 level 切换,跟现有「按拼音/按部首」正交
- 右键追加走专用 endpoint,append 到每用户唯一的「我的字帖」(有就追加,没就建)
- 反馈用全局 toast(新增基础设施),anonymous 用户也能看到菜单但 API 返 401 时给提示
- 已存在的字不重复加,直接 toast「已存在」

## Non-Goals

- 不做 worksheet 多选 UI(本次每用户只有一个「我的字帖」)
- 不做「我的字帖」删除/重命名(用户可在 `/worksheet` history 页删整条)
- 不做并发安全 DB 约束(下文风险部分说明)
- 不做移动端长按弹出菜单(只桌面右键)
- 不动其它页面的右键行为

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

## 文件清单

**新建:**
- `lib/worksheet-append.ts`
- `app/api/worksheets/append/route.ts`
- `lib/toast-store.ts`
- `components/common/Toast.tsx`(含 `ToastViewport`)
- `components/dictionary/CharContextMenu.tsx`
- `components/dictionary/DictionaryCharGridClient.tsx`
- `tests/unit/lib/worksheet-append.test.ts`
- `tests/integration/api/worksheets-append.test.ts`

**修改:**
- `components/dictionary/DictionaryClient.tsx` — 加 level 切换按钮
- `components/dictionary/DictionaryCharGrid.tsx` — 改为薄壳 wrapper
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
- `pnpm test tests/unit/lib/worksheet-append.test.ts` — 单元全过
- `pnpm test tests/integration/api/worksheets-append.test.ts` — 集成全过
- 浏览器人工冒烟:登录 → /dictionary 切 level → 右键 → toast → 跳 /worksheet/<id> 看到新字

## 提交

1 commit: `feat(dictionary): level filter + right-click append to 我的字帖`