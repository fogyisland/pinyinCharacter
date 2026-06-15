# Edge TTS + 男/女声 + 后台配置 设计文档

**目标**: 把 `ReadAloudButton` 从浏览器 `speechSynthesis` 升级到 Microsoft Edge TTS (高质量神经网络音色),支持男/女声区分 (读字=男声,读音=女声),并把 voice 配置放在 admin 后台可调。同时修复 BentoGrid 的白字 bug。

**架构**: 服务端代理 (Next.js `app/api/tts/route.ts` ↔ Edge TTS WebSocket) + 客户端 `new Audio()` 播放 + `app_config` 表存 voice 默认值 + 新 admin 页 `/admin/tts` 编辑。

**技术栈**: Next.js 15 (App Router, Route Handlers), TypeScript, WebSocket (`ws` 包), mysql2, zod (input 校验)。无新前端依赖。

---

## 1. 背景与目标

### 现状 (2026-06-15)

- `lib/tts.ts` — 浏览器 `window.speechSynthesis` + `SpeechSynthesisUtterance`,无 voice 偏好,无 rate/pitch 持久化
- 13 个 `ReadAloudButton` 调用点 (字典/字源/故事/佛经/拼音转换/罕见字详情等)
- `app/admin/ai/page.tsx` — 唯一 config UI,只覆盖 4 个 AI key
- `app_config(key, value)` — 已存 4 个 AI key,无 TTS 相关
- 配色 token:`text-paper-soft` (`#FFFAEE` cream-white) + `bg-ink` (`#3A2A14` dark) 设计上 inverse 使用

### 问题

1. **白字 bug** — `BentoGrid.tsx` 把 `card-paper` + `bg-ink` 同时应用,`card-paper` 的 `background-color: #FFFAEE` 覆盖 `bg-ink` 的 dark,导致 cream 背景 + cream 文字 = 看不见
2. **TTS 质量** — 浏览器 `speechSynthesis` 在不同 OS 上声音差异大,中文女声经常是机器人音,Edge 神经网络音 (e.g. XiaoxiaoNeural) 自然度高得多
3. **无 voice 偏好** — 用户无法选男/女声,管理员无法统一调

### 目标

1. **修复白字 bug** — `card-paper` 改为 `background: transparent`,只保留 border/shadow/hover
2. **服务端代理 Edge TTS** — `app/api/tts/route.ts` POST `{text, voice}` → `audio/mpeg` blob
3. **男/女声区分** — `ReadAloudButton` 加 `voice` prop,字典页读字=男,读音=女;其它页面默认女 (XiaoxiaoNeural)
4. **后台配置** — `/admin/tts` 页可改 voice 默认值,存 `app_config`

### 不做 (YAGNI)

- 不做音频缓存 (重复朗读重新合成,Edge 没明确限频,后续真有限再加 Redis)
- 不做用户个人 voice 偏好 (admin 全局默认,后续需要再加 users 表列)
- 不做 SSML 高级特性 (e.g. `<break>`, `<emphasis>`),只传纯文本
- 不支持非 zh-CN 语言
- 不改现有 admin/ai 页结构,新建独立 /admin/tts
- 不动 `app/globals.css` 的 `@theme` token 值,只改 `.card-paper` 一处

---

## 2. 架构

### 2.1 数据流

```
[BentoGrid card]  (修白字)
  └─ className="card-paper"  (transparent bg,保留 border+shadow)
     +  variantClass = 'bg-ink text-paper-soft'  → dark bg + light text ✓

[ReadAloudButton "读字"] (字典页,男声)
  └─ lib/tts.speak(char, {voice:'male'})
     └─ fetch POST /api/tts {text: char, voice:'male'}
        └─ lib/tts-edge.synthesize(text, voiceName='zh-CN-YunjianNeural')
           ├─ ws://speech.platform.bing.com/.../v1?... (WSS)
           ├─ 发送 SSML config + data headers
           └─ 累积 audio chunks → Buffer
        └─ response: audio/mpeg blob
     └─ new Audio(blobUrl).play()

[Admin /admin/tts] (改 voice 默认)
  └─ form submit → POST /api/admin/config {tts.voice_male: '...'}
     └─ lib/config.setConfigBatch()
        └─ UPDATE app_config SET value=...
```

### 2.2 配置文件 (新增 KEY_VALIDATORS)

```typescript
// lib/config.ts (扩展)
const KEY_VALIDATORS: Record<string, (v: string) => boolean> = {
  // ... existing 4 AI keys
  'tts.voice_male':   (v) => /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(v),
  'tts.voice_female': (v) => /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(v),
  'tts.audio_format': (v) => [
    'audio-24khz-48kbitrate-mono-mp3',
    'audio-24khz-96kbitrate-mono-mp3',
    'audio-16khz-32kbitrate-mono-mp3',
    'audio-16khz-128kbitrate-mono-mp3',
  ].includes(v),
};
```

**默认值** (init 时插入,idempotent):
```
tts.voice_male   = 'zh-CN-YunjianNeural'
tts.voice_female = 'zh-CN-XiaoxiaoNeural'
tts.audio_format = 'audio-24khz-48kbitrate-mono-mp3'
```

插入位置:`scripts/init-db.ts` 的 `app_config` seed 段落,沿用 `if (cfgCount === 0)` 分支。

### 2.3 Edge TTS WebSocket 协议

**Endpoint**: `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`

**必需 query params**:
- `TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4` (公开常量)
- `ConnectionId=<random uuid>`

**必需 headers**:
- `Pragma: no-cache`
- `Cache-Control: no-cache`
- `Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold`
- `Accept-Encoding: gzip, deflate, br`
- `Accept-Language: en-US,en;q=0.9`
- `User-Agent: Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/...Safari/537.36 Edge/...`

**消息序列** (binary frame + text frame 交替):
1. text frame: `{"context":{"system":{"name":"SpeechSDK","version":"1.0.0","build":"..."},"os":{"platform":"Win32","name":"Windows","version":"10"}}}`
2. text frame SSML config: `X-Timestamp:<date>\r\nContent-Type:application/ssml+xml\r\nX-Path:voice\r\n\r\n<SSML>...</SSML>` (注意末尾要有两个 CRLF)
3. text frame speech config: `X-Timestamp:<date>\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataOptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
4. binary frame audio data: `X-Timestamp:...\r\nPath:audio\r\nContent-Type:audio/mpeg\r\n\r\n<binary mp3>`
5. text frame turn-end: (close)

**音频**: 累积每个 binary frame 里 Path:audio 后面的 mp3 数据,串接成 Buffer。

> 注: 协议细节以 [edge-tts GitHub 仓库](https://github.com/rany2/edge-tts) 为准,实际实现时按其 Python 源码翻译。

---

## 3. 数据模型

### 3.1 新增文件清单

```
app/
├── api/
│   ├── tts/
│   │   └── route.ts                  [NEW] POST handler, Edge TTS 代理
│   └── admin/
│       └── config/
│           └── route.ts              [NEW] GET/PUT config (复用 setConfigBatch 模式)
└── admin/
    └── tts/
        ├── page.tsx                  [NEW] 表单页 (server component)
        └── TtsForm.tsx               [NEW] client form
components/
├── AdminNav.tsx                      [MOD] 加「语音设置」入口
└── ReadAloudButton.tsx               [MOD] 加 voice prop
lib/
├── tts-edge.ts                       [NEW] Edge TTS WebSocket 封装
├── tts-config.ts                     [NEW] 读 tts.* 默认值
└── tts.ts                            [MOD] speak() 改 fetch + new Audio()
scripts/
└── init-db.ts                        [MOD] 加 tts.* 默认值 seed
tests/
├── unit/
│   ├── lib/
│   │   ├── tts-edge.test.ts          [NEW] WebSocket 协议 mock 测试
│   │   └── tts-config.test.ts        [NEW] 默认值读取
│   └── integration/
│       └── api/
│           └── tts.test.ts           [NEW] /api/tts 端到端 (无 DB 也跑)
app/globals.css                       [MOD] .card-paper 改 transparent bg
```

### 3.2 app/api/tts/route.ts 接口

```typescript
// POST /api/tts
// Body: { text: string, voice: 'male' | 'female' }
// 200: audio/mpeg binary
// 400: { error: 'text too long' | 'invalid voice' }
// 502: { error: 'edge tts upstream failed' }
// 504: { error: 'edge tts timeout' }

export const runtime = 'nodejs';   // WebSocket 需要 Node runtime, 不能 edge
export const maxDuration = 30;     // 30s 上限

const MAX_TEXT_LEN = 1000;

export async function POST(req: Request) {
  const body = await req.json();
  const { text, voice } = body ?? {};

  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_LEN) {
    return Response.json({ error: 'text must be 1-1000 chars' }, { status: 400 });
  }
  if (voice !== 'male' && voice !== 'female') {
    return Response.json({ error: 'voice must be male or female' }, { status: 400 });
  }

  const { voice_male, voice_female, audio_format } = await getTtsConfig();
  const voiceName = voice === 'male' ? voice_male : voice_female;

  try {
    const buffer = await synthesize(text, voiceName, audio_format, 15_000);  // 15s timeout
    return new Response(buffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    if ((err as Error).message === 'TIMEOUT') {
      return Response.json({ error: 'edge tts timeout' }, { status: 504 });
    }
    return Response.json({ error: 'edge tts upstream failed' }, { status: 502 });
  }
}
```

### 3.3 lib/tts-edge.ts 接口

```typescript
// lib/tts-edge.ts
import WebSocket from 'ws';

const EDGE_WSS = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

interface SynthesizeOpts {
  voiceName: string;     // 'zh-CN-YunjianNeural'
  audioFormat: string;   // 'audio-24khz-48kbitrate-mono-mp3'
  timeoutMs?: number;    // default 15000
}

export async function synthesize(text: string, opts: SynthesizeOpts): Promise<Buffer> {
  // Build connectionId, headers
  // Open WSS, accumulate audio frames
  // Return Buffer
  // Throw Error('TIMEOUT') on timeout
}

// Build SSML for plain text (escape XML special chars)
export function buildSsml(text: string, voiceName: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
    <voice name='${voiceName}'>${escaped}</voice>
  </speak>`;
}
```

### 3.4 lib/tts.ts (新接口,向后兼容)

```typescript
// lib/tts.ts (replace existing)
'use client';

export type Voice = 'male' | 'female';

let currentAudio: HTMLAudioElement | null = null;

export interface SpeakOpts {
  voice?: Voice;          // default 'female'
  rate?: number;          // 0.5-2, default 1, audio playspeed
  onEnd?: () => void;
}

export async function speak(text: string, opts: SpeakOpts = {}): Promise<void> {
  if (typeof window === 'undefined') return;
  stopSpeaking();
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: opts.voice ?? 'female' }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = opts.rate ?? 1;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      opts.onEnd?.();
    };
    currentAudio = audio;
    await audio.play();
  } catch (err) {
    console.error('[tts] speak failed', err);
    opts.onEnd?.();
  }
}

export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    URL.revokeObjectURL(currentAudio.src);
    currentAudio = null;
  }
}

// Deprecated: 旧 browser speech 路径, 保留以防破坏 import
export function pickChineseVoice(): null { return null; }
```

### 3.5 ReadAloudButton 改动

```typescript
// components/ReadAloudButton.tsx
interface Props {
  text: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'paper' | 'ink' | 'seal';
  className?: string;
  voice?: 'male' | 'female';   // [NEW] default 'male'
  title?: string;
}

export function ReadAloudButton({
  text, voice = 'male', /* ... */
}) {
  // speak() 现在是 async,但我们不让 button 等 promise
  // isSpeaking 在点击时立即设 true,onEnd 回调设 false
  // 如果 fetch 失败 onEnd 也会被调用
  function handleClick() {
    if (!text) return;
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
    } else {
      setIsSpeaking(true);
      speak(text, { voice, onEnd: () => setIsSpeaking(false) });
    }
  }
  // ...
}
```

### 3.6 字典页改用 voice

```typescript
// app/dictionary/[char]/page.tsx 调用方不动
// components/dictionary/DictionaryDetailTabs.tsx
<ReadAloudButton text={char.char} label="读字" voice="male" .../>     // 改: voice="male"
<ReadAloudButton text={char.pinyin} label="读音" voice="female" .../>  // 改: voice="female"
```

### 3.7 /admin/tts 页面

```typescript
// app/admin/tts/page.tsx (server component)
import { requireAdmin } from '@/lib/auth';
import { getAllConfig } from '@/lib/config';
import { TtsForm } from './TtsForm';

export const dynamic = 'force-dynamic';

export default async function TtsConfigPage() {
  await requireAdmin();
  const config = await getAllConfig();
  return (
    <>
      <PageContainer>
        <SectionTitle>语音设置</SectionTitle>
        <TtsForm initial={{
          voice_male: config['tts.voice_male'] ?? 'zh-CN-YunjianNeural',
          voice_female: config['tts.voice_female'] ?? 'zh-CN-XiaoxiaoNeural',
          audio_format: config['tts.audio_format'] ?? 'audio-24khz-48kbitrate-mono-mp3',
        }} />
      </PageContainer>
    </>
  );
}
```

**Form 形态**:
- 男声: `<select>` with 6 个 Edge voice (YunjianNeural / YunxiNeural / YunyangNeural)
- 女声: `<select>` with 6 个 Edge voice (XiaoxiaoNeural / XiaoyiNeural / XiaomengNeural / XiaohanNeural / XiaomoNeural / XiaoruiNeural)
- Audio format: `<select>` with 4 个 mp3 bitrate
- 提交按钮 → PUT /api/admin/config

### 3.8 白字 bug 修复 (单文件)

```css
/* app/globals.css */
.card-paper {
  background: transparent;        /* [CHANGED] from #FFFAEE */
  border: 1px solid rgba(58, 42, 20, 0.10);
  box-shadow: var(--shadow-paper);
  transition: box-shadow 200ms, border-color 200ms, background-color 200ms;  /* 加 bg transition */
}
.card-paper:hover {
  border-color: #B22B2B;
  box-shadow: var(--shadow-paper-md);
}
```

`background: transparent` 让 Tailwind 的 `bg-ink`/`bg-seal` 生效,但保留 card 的 border + shadow + hover。

---

## 4. 组件与代码

### 4.1 AdminNav 加入口

```typescript
// components/AdminNav.tsx (modify existing entries array)
// 加一项:
{ href: '/admin/tts', label: '语音设置' }
```

### 4.2 api/admin/config 路由

复用现有 `setConfigBatch`,新增 `app/api/admin/config/route.ts`:

```typescript
// PUT /api/admin/config
// Body: { updates: Record<string, string> }
// 403: 非 admin
// 400: key 不在 KEY_VALIDATORS
// 200: { updated: number }

import { requireAdmin } from '@/lib/auth';
import { setConfigBatch, KEY_VALIDATORS } from '@/lib/config';

export async function PUT(req: Request) {
  const user = await requireAdmin();
  const body = await req.json();
  const updates = body?.updates ?? {};
  for (const k of Object.keys(updates)) {
    if (!KEY_VALIDATORS[k]) {
      return Response.json({ error: `unknown key: ${k}` }, { status: 400 });
    }
  }
  await setConfigBatch(updates, user.id);
  return Response.json({ updated: Object.keys(updates).length });
}
```

> **注意**:`requireAdmin()` 默认 401/403 重定向,这里需要 JSON 化。改成自定义函数或捕获 redirect。

### 4.3 错误处理

- Edge TTS timeout → 504,前端 console.error
- Edge TTS WS 关闭 → 502,前端 console.error
- text 过长 (≤1000) → 400
- 网络断开 → 502
- audio.play() 浏览器自动拦截 → onError → console.error
- 用户未登录访问 /admin/tts → 重定向 `/?auth=login`

### 4.4 测试

#### Unit (`tests/unit/lib/tts-edge.test.ts`)
- `buildSsml('hello <world>', 'zh-CN-YunjianNeural')` → 含 XML 转义
- `synthesize` mock WebSocket,验证发送的 SSML + config frames
- timeout 触发 → throw Error('TIMEOUT')

#### Unit (`tests/unit/lib/tts-config.test.ts`)
- `getTtsConfig()` 没值时返回 defaults (zh-CN-YunjianNeural / XiaoxiaoNeural / audio-24khz-48kbitrate-mono-mp3)
- 有值时返回 DB 里的值

#### Integration (`tests/integration/api/tts.test.ts`)
- POST /api/tts 无 text → 400
- POST /api/tts {voice: 'invalid'} → 400
- POST /api/tts {text: '你好', voice: 'female'} → 200 audio/mpeg (需要真实网络,无网络 skip)
- POST /api/tts text 超长 (1001 chars) → 400

#### Smoke (人工)
- /admin/tts 改男声为 YunxiNeural,刷新页面验证
- 字典页 /dictionary/一 点「读字」听男声
- 字典页 /dictionary/一 点「读音」(有 pinyin 的字) 听女声
- 首页 BentoGrid 5 张卡片文字可见

### 4.5 不在范围

- Edge TTS 音频缓存(写时合 + 存磁盘 / Redis) — YAGNI,后续真有性能问题再加
- 用户 profile 偏好 — admin 全局足够,后续需要再加 users.voice_pref 列
- 语音合成历史记录 / 计量 — 无意义

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Edge TTS 协议变化 (Microsoft 改 endpoint/token) | 用成熟的 edge-tts 开源协议参考;监测 fallback 到浏览器 speech |
| WebSocket 在 Next.js dev/prod 行为差异 | 固定 `runtime = 'nodejs'`,不用 edge runtime |
| 服务器 CPU/内存打满(高频朗读) | maxDuration=30s + text 长度上限 1000;后续加 rate limit |
| Edge TTS 服务下线(地域限制) | 401/403 时降级到浏览器 `speechSynthesis` + 提示用户 |
| 浏览器 `new Audio()` autoplay 拦截(首次无用户手势) | ReadAloudButton 一定在点击事件触发,无 autoplay 问题 |
| 儿童内容/版权文本被合成 | 仅合成用户主动点击的、站点内文本,无外部输入;无需额外过滤 |
| `card-paper` 改 transparent 后其他页面 hover bg 变化 | 检查所有 `card-paper` 使用处;outline 卡片 (BentoGrid 第 3-5 张) 的 bg-paper-soft 会丢,补回 hover bg |

---

## 6. 执行顺序 (Phase)

| Phase | 内容 | 验证 |
|---|---|---|
| **P1: 修白字 bug** | globals.css `.card-paper` 改 transparent | 首页 BentoGrid 5 卡文字可见 |
| **P2: lib/tts-edge + WebSocket** | 实现 synthesize + buildSsml + unit test | `pnpm test tests/unit/lib/tts-edge.test.ts` |
| **P3: lib/tts-config + KEY_VALIDATORS** | 加 3 个 key + 默认 seed | `pnpm test tests/unit/lib/tts-config.test.ts` |
| **P4: app/api/tts/route.ts** | POST handler,fetch + buffer | `pnpm test tests/integration/api/tts.test.ts` |
| **P5: lib/tts.ts 改造** | speak 改 fetch + new Audio() | type-check |
| **P6: ReadAloudButton 加 voice prop** | 默认 male,DictionaryDetailTabs 用 male/female | type-check |
| **P7: /admin/tts 页面 + api/admin/config** | 表单 + PUT handler | admin 登录后能改并保存 |
| **P8: AdminNav 入口** | 加「语音设置」 | nav 显示 |
| **P9: 浏览器 smoke** | 字典页读字/读音 + admin 改 voice + 首页无白字 | 人工 |

---

## 7. 关键代码引用

- TTS 接口:`lib/tts.ts`(现有),13 个调用点全 grep 过
- Admin pattern:`app/admin/ai/page.tsx`,`lib/config.ts`,`lib/api-admin.ts`
- 设计 token:`app/globals.css` `@theme { --color-* }` + `@layer utilities { .card-paper ... }`
- Edge TTS 协议参考: github.com/rany2/edge-tts (Python 实现,翻译到 TS)
- 白字 bug 复现:`components/BentoGrid.tsx:46,69,82` (`card-paper` + `bg-ink`)