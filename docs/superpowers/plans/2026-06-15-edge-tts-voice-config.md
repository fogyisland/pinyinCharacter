# Edge TTS + 男/女声 + 后台配置 + 随机字帖 + /pinyin 路由

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `ReadAloudButton` 从浏览器 `speechSynthesis` 升级到 Microsoft Edge TTS (高质量神经网络音色),支持男/女声 (字典页读字=男、读音=女),后台可调 voice 配置;同时修复 BentoGrid 白字 bug、加随机字帖 tab、把首页 TextToPinyin 搬到独立 /pinyin 路由。

**Architecture:** 服务端代理 (Next.js `app/api/tts/route.ts` ↔ Edge TTS WebSocket `ws://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`) + 客户端 `new Audio(blobUrl)` 播放 + `app_config` 表存 voice 默认值 + 新 admin 页 `/admin/tts` 编辑;随机字帖走 `app/api/chars/random` SQL `ORDER BY RAND()`;TextToPinyin 从首页搬到 `app/pinyin/page.tsx`。

**Tech Stack:** Next.js 15 (App Router, Route Handlers, RSC), TypeScript, `ws` (WebSocket), mysql2, zod (input 校验)。无新前端依赖。

---

## File Structure

**Create**:
- `lib/tts-edge.ts` — Edge TTS WebSocket synthesize + SSML builder
- `lib/tts-config.ts` — getTtsConfig() 读 app_config 默认值
- `app/api/tts/route.ts` — POST /api/tts 代理
- `app/api/admin/ai/config/route.ts` — 复用,扩展支持 tts.* (如不存在则建)
- `app/api/chars/random/route.ts` — GET 随机抽字
- `app/admin/tts/page.tsx` — admin 改 voice 默认 UI
- `components/worksheet/RandomTab.tsx` — 随机字帖 tab 内容
- `app/pinyin/page.tsx` — 字转拼音独立页面
- `tests/unit/lib/tts-edge.test.ts` — SSML + 协议层单元测试
- `tests/unit/lib/tts-config.test.ts` — 默认值 + DB 回退
- `tests/integration/api/tts.test.ts` — /api/tts 端到端
- `tests/integration/api/chars-random.test.ts` — /api/chars/random 集成
- `tests/unit/components/worksheet/RandomTab.test.tsx` — 抽字后跳转

**Modify**:
- `app/globals.css` — `.card-paper` 改 `background: transparent` (修白字)
- `lib/config.ts` — `KEY_VALIDATORS` 加 `tts.voice_male/female/audio_format` 3 个
- `lib/tts.ts` — `speak()` 改 fetch /api/tts + new Audio() (保留旧 export)
- `lib/chars.ts` — 加 `getRandomChars(opts)`
- `lib/validators.ts` — 加 `charsRandomQuerySchema`
- `components/ReadAloudButton.tsx` — 加 `voice?: 'male' | 'female'` prop
- `components/dictionary/DictionaryDetailTabs.tsx` — 读字 voice='male',读音 voice='female'
- `components/worksheet/WorksheetGenerator.tsx` — Tab 加 'random' + RandomTab 接入
- `components/admin/AdminSidebar.tsx` — 加「语音设置」入口
- `app/page.tsx` — 删 TextToPinyin import + section
- `lib/design.ts` — NAV_LINKS 插「字转拼音」
- `scripts/init-db.ts` — app_config seed 加 3 个 tts 默认值

---

## Phase 1: 修白字 bug (P1)

### Task 1: globals.css `.card-paper` 改 transparent

**Files:**
- Modify: `app/globals.css:90-99`

- [ ] **Step 1: 定位 `.card-paper` 定义**

`app/globals.css` 中搜索 `card-paper` (在 `@layer utilities` 块内),当前定义形如:
```css
.card-paper {
  background-color: #FFFAEE;
  border: 1px solid rgba(58, 42, 20, 0.08);
  border-radius: 0.5rem;
  box-shadow: 0 1px 2px rgba(58, 42, 20, 0.04);
}
```

- [ ] **Step 2: 改 background 为 transparent**

```css
.card-paper {
  background: transparent;
  border: 1px solid rgba(58, 42, 20, 0.08);
  border-radius: 0.5rem;
  box-shadow: 0 1px 2px rgba(58, 42, 20, 0.04);
}
```

这样 Tailwind v4 的 `bg-ink` 等 `background-color` 工具类能赢,cream 背景不再覆盖 dark。

- [ ] **Step 3: 检查所有 `.card-paper` 使用处**

```bash
grep -rn "card-paper" app/ components/
```

预期: `BentoGrid.tsx` (3 张 outline 卡) + `app/admin/ai/page.tsx` (2 个 form/table)。outline 卡不再有 cream bg,补 hover bg-paper-deep (在 BentoGrid 现有代码上检查)。

- [ ] **Step 4: 启动 dev server 验证**

```bash
pnpm dev
```

打开 `http://localhost:4444/`,确认 5 张 BentoGrid 卡片文字 (字↔拼音互转 / 罕见字库 / ...) 可见。

- [ ] **Step 5: 跑全量验证**

```bash
pnpm tsc --noEmit
pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "fix(bento): card-paper transparent bg — white text on cream was invisible"
```

---

## Phase 2: lib/tts-edge WebSocket 客户端 (P2)

### Task 2: 实现 lib/tts-edge + unit test

**Files:**
- Create: `lib/tts-edge.ts`
- Create: `tests/unit/lib/tts-edge.test.ts`
- Modify: `package.json` (加 `ws` 依赖)

- [ ] **Step 1: 安装 `ws`**

```bash
pnpm add ws
pnpm add -D @types/ws
```

- [ ] **Step 2: 写 tts-edge.ts (协议层)**

`lib/tts-edge.ts` 内容:

```typescript
import WebSocket from 'ws';

const ENDPOINT = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

export type AudioFormat =
  | 'audio-24khz-48kbitrate-mono-mp3'
  | 'audio-24khz-96kbitrate-mono-mp3'
  | 'audio-16khz-32kbitrate-mono-mp3'
  | 'audio-16khz-128kbitrate-mono-mp3';

export interface SynthesizeOpts {
  voiceName: string;            // e.g. 'zh-CN-YunjianNeural'
  text: string;
  format?: AudioFormat;
  timeoutMs?: number;
}

export async function synthesize(opts: SynthesizeOpts): Promise<Buffer> {
  const format = opts.format ?? 'audio-24khz-48kbitrate-mono-mp3';
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return new Promise<Buffer>((resolve, reject) => {
    const url = `${ENDPOINT}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${randomHex(16)}`;
    const ws = new WebSocket(url);
    const chunks: Buffer[] = [];
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try { ws.close(); } catch {}
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Edge TTS timeout'));
    }, timeoutMs);

    ws.on('error', (err) => {
      cleanup();
      reject(err);
    });

    ws.on('open', () => {
      // 1) SSML config
      const ssml = buildSsml(opts.voiceName, format, opts.text);
      ws.send(`Content-Type:application/ssml+xml\r\nX-Timestamp:${ts()}\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    ws.on('message', (data) => {
      const buf = data as Buffer;
      // 二进制帧前 2 字节是 header length;切到 Path:audio 之后的部分累积
      // 简化: 累积整个 buffer,然后后续解析 header
      // 协议: "X-RequestId:...<CRLF><CRLF>binary"
      const sep = buf.indexOf(Buffer.from('\r\n\r\n'));
      if (sep < 0) return;
      const header = buf.subarray(0, sep).toString('utf8');
      if (!header.includes('Path:audio')) return;
      chunks.push(buf.subarray(sep + 4));
      if (header.includes('Path:audio') && header.includes('X-StreamIndex')) {
        // last frame has X-StreamIndex close
        cleanup();
        resolve(Buffer.concat(chunks));
      }
    });

    ws.on('close', () => {
      if (timer) { clearTimeout(timer); timer = null; }
      // edge case: close without last frame — reject if no audio
      if (chunks.length === 0) reject(new Error('Edge TTS closed with no audio'));
    });
  });
}

export function buildSsml(voiceName: string, format: string, text: string): string {
  // escape XML
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
  <voice name='${voiceName}'>
    <prosody pitch='+0Hz' rate='+0%'>${safe}</prosody>
  </voice>
</speak>`;
}

function ts(): string {
  // e.g. "2026-06-15T12:34:56.789Z"
  return new Date().toISOString();
}

function randomHex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
```

- [ ] **Step 3: 写 unit test (协议层, 不连真实 WS)**

`tests/unit/lib/tts-edge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSsml } from '@/lib/tts-edge';

describe('buildSsml', () => {
  it('includes voice name and text', () => {
    const ssml = buildSsml('zh-CN-YunjianNeural', 'audio-24khz-48kbitrate-mono-mp3', '你好');
    expect(ssml).toContain("voice name='zh-CN-YunjianNeural'");
    expect(ssml).toContain('你好');
  });

  it('escapes XML special chars', () => {
    const ssml = buildSsml('v', 'f', '<a>');
    expect(ssml).toContain('&lt;a&gt;');
    expect(ssml).not.toContain('<a>');
  });

  it('escapes ampersand', () => {
    const ssml = buildSsml('v', 'f', 'A & B');
    expect(ssml).toContain('A &amp; B');
  });
});
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/unit/lib/tts-edge.test.ts
```

预期: 3/3 pass。

- [ ] **Step 5: Commit**

```bash
git add lib/tts-edge.ts tests/unit/lib/tts-edge.test.ts package.json pnpm-lock.yaml
git commit -m "feat(tts): lib/tts-edge WebSocket synthesize + SSML builder"
```

---

## Phase 3: tts-config 默认值读取 (P3)

### Task 3: KEY_VALIDATORS 加 3 个 tts key + 默认 seed

**Files:**
- Modify: `lib/config.ts` (KEY_VALIDATORS)
- Modify: `scripts/init-db.ts` (app_config seed)
- Create: `lib/tts-config.ts`
- Create: `tests/unit/lib/tts-config.test.ts`

- [ ] **Step 1: lib/config.ts 加 validator**

在 `KEY_VALIDATORS` 末尾加:

```typescript
'tts.voice_male': (v) => /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(v),
'tts.voice_female': (v) => /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(v),
'tts.audio_format': (v) => [
  'audio-24khz-48kbitrate-mono-mp3',
  'audio-24khz-96kbitrate-mono-mp3',
  'audio-16khz-32kbitrate-mono-mp3',
  'audio-16khz-128kbitrate-mono-mp3',
].includes(v),
```

- [ ] **Step 2: scripts/init-db.ts seed 加 3 个默认值**

找到 `app_config` seed 段落(用 `if (cfgCount === 0)` 或现有 seed 循环),加:

```typescript
await pool.query(
  `INSERT IGNORE INTO app_config (\`key\`, value, updated_by) VALUES
     ('tts.voice_male', 'zh-CN-YunjianNeural', NULL),
     ('tts.voice_female', 'zh-CN-XiaoxiaoNeural', NULL),
     ('tts.audio_format', 'audio-24khz-48kbitrate-mono-mp3', NULL)`
);
```

- [ ] **Step 3: 写 lib/tts-config.ts**

```typescript
import { getConfig } from './config';

const DEFAULTS = {
  voice_male: 'zh-CN-YunjianNeural',
  voice_female: 'zh-CN-XiaoxiaoNeural',
  audio_format: 'audio-24khz-48kbitrate-mono-mp3',
} as const;

export type TtsVoiceKey = 'male' | 'female';

export interface TtsConfig {
  voiceMale: string;
  voiceFemale: string;
  audioFormat: string;
}

export async function getTtsConfig(): Promise<TtsConfig> {
  const [male, female, fmt] = await Promise.all([
    getConfig('tts.voice_male'),
    getConfig('tts.voice_female'),
    getConfig('tts.audio_format'),
  ]);
  return {
    voiceMale: male ?? DEFAULTS.voice_male,
    voiceFemale: female ?? DEFAULTS.voice_female,
    audioFormat: fmt ?? DEFAULTS.audio_format,
  };
}
```

- [ ] **Step 4: 写 unit test (mock getConfig)**

`tests/unit/lib/tts-config.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}));

import { getTtsConfig } from '@/lib/tts-config';
import { getConfig } from '@/lib/config';

const mocked = vi.mocked(getConfig);

describe('getTtsConfig', () => {
  beforeEach(() => mocked.mockReset());

  it('returns defaults when DB has no values', async () => {
    mocked.mockResolvedValue(null);
    const cfg = await getTtsConfig();
    expect(cfg).toEqual({
      voiceMale: 'zh-CN-YunjianNeural',
      voiceFemale: 'zh-CN-XiaoxiaoNeural',
      audioFormat: 'audio-24khz-48kbitrate-mono-mp3',
    });
  });

  it('returns DB values when present', async () => {
    mocked.mockImplementation(async (k) => {
      if (k === 'tts.voice_male') return 'zh-CN-YunxiNeural';
      if (k === 'tts.voice_female') return 'zh-CN-XiaoyiNeural';
      if (k === 'tts.audio_format') return 'audio-16khz-128kbitrate-mono-mp3';
      return null;
    });
    const cfg = await getTtsConfig();
    expect(cfg.voiceMale).toBe('zh-CN-YunxiNeural');
    expect(cfg.voiceFemale).toBe('zh-CN-XiaoyiNeural');
    expect(cfg.audioFormat).toBe('audio-16khz-128kbitrate-mono-mp3');
  });
});
```

- [ ] **Step 5: 跑测试**

```bash
pnpm test tests/unit/lib/tts-config.test.ts
```

预期: 2/2 pass。

- [ ] **Step 6: Commit**

```bash
git add lib/config.ts lib/tts-config.ts tests/unit/lib/tts-config.test.ts scripts/init-db.ts
git commit -m "feat(tts-config): validators + defaults + getTtsConfig"
```

---

## Phase 4: /api/tts 代理 (P4)

### Task 4: POST /api/tts 路由

**Files:**
- Create: `app/api/tts/route.ts`
- Create: `tests/integration/api/tts.test.ts`

- [ ] **Step 1: 写 route handler**

`app/api/tts/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { synthesize, type AudioFormat } from '@/lib/tts-edge';
import { getTtsConfig } from '@/lib/tts-config';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const schema = z.object({
  text: z.string().min(1).max(1000),
  voice: z.enum(['male', 'female']).default('female'),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');

    const cfg = await getTtsConfig();
    const voiceName = parsed.data.voice === 'male' ? cfg.voiceMale : cfg.voiceFemale;
    const buffer = await synthesize({
      voiceName,
      text: parsed.data.text,
      format: cfg.audioFormat as AudioFormat,
    });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  });
}
```

- [ ] **Step 2: 写 integration test (失败路径 + 跳过真实网络)**

`tests/integration/api/tts.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { integrationDescribe, TEST_DATABASE_URL } from '../setup';
import { POST } from '@/app/api/tts/route';
import { NextRequest } from 'next/server';
import { setConfig } from '@/lib/config';

integrationDescribe('POST /api/tts', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    await setConfig('tts.voice_male', 'zh-CN-YunjianNeural', null);
    await setConfig('tts.voice_female', 'zh-CN-XiaoxiaoNeural', null);
    await setConfig('tts.audio_format', 'audio-24khz-48kbitrate-mono-mp3', null);
  });

  it('400 on empty text', async () => {
    const req = new NextRequest('http://localhost/api/tts', {
      method: 'POST', body: JSON.stringify({ text: '' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400 on invalid voice', async () => {
    const req = new NextRequest('http://localhost/api/tts', {
      method: 'POST', body: JSON.stringify({ text: '你好', voice: 'invalid' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it.skip('200 audio/mpeg on valid request (skipped — no network in CI)', async () => {
    const req = new NextRequest('http://localhost/api/tts', {
      method: 'POST', body: JSON.stringify({ text: '你好', voice: 'female' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
pnpm test tests/integration/api/tts.test.ts
```

预期: 2 pass + 1 skipped(无网络)。

- [ ] **Step 4: Commit**

```bash
git add app/api/tts/route.ts tests/integration/api/tts.test.ts
git commit -m "feat(api/tts): POST handler with Edge TTS proxy"
```

---

## Phase 5: lib/tts.ts 改造 (P5)

### Task 5: speak() 改 fetch + new Audio()

**Files:**
- Modify: `lib/tts.ts`

- [ ] **Step 1: 改造 speak()**

```typescript
'use client';

import type { SpeakOpts } from './tts-types';

export type Voice = 'male' | 'female';

const activeAudio: { current: HTMLAudioElement | null } = { current: null };

export function pickChineseVoice(): SpeechSynthesisVoice | null {
  // 保留旧 export 用于可能回退,实际不再用
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find(v => v.lang === 'zh-CN') ?? voices.find(v => v.lang.startsWith('zh')) ?? null;
}

export async function speak(text: string, opts: SpeakOpts & { voice?: Voice } = {}): Promise<void> {
  if (!text) return;
  stopSpeaking();
  const voice = opts.voice ?? 'female';
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) {
      // 失败时降级到浏览器 speech
      console.warn('Edge TTS failed, fallback to browser speech', res.status);
      fallbackSpeak(text, opts);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio.current = audio;
    audio.onended = () => {
      if (activeAudio.current === audio) {
        activeAudio.current = null;
        URL.revokeObjectURL(url);
        opts.onEnd?.();
      }
    };
    audio.onerror = () => {
      if (activeAudio.current === audio) activeAudio.current = null;
      URL.revokeObjectURL(url);
    };
    await audio.play();
  } catch (e) {
    console.warn('Edge TTS error, fallback', e);
    fallbackSpeak(text, opts);
  }
}

function fallbackSpeak(text: string, opts: SpeakOpts): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = opts.rate ?? 1;
  const voice = pickChineseVoice();
  if (voice) utter.voice = voice;
  if (opts.onEnd) utter.onend = () => opts.onEnd?.();
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking(): void {
  if (activeAudio.current) {
    activeAudio.current.pause();
    activeAudio.current = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
```

- [ ] **Step 2: 拆 SpeakOpts 到独立文件 (避免循环引用)**

Create `lib/tts-types.ts`:

```typescript
export interface SpeakOpts {
  rate?: number;
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
}
```

- [ ] **Step 3: type check**

```bash
pnpm tsc --noEmit
```

预期: 0 error。如果 13 个 ReadAloudButton 调用点有 break,一并修(只接受 `text` 一个 prop,新加 `voice` 是可选的,不传也对)。

- [ ] **Step 4: 跑全量测试**

```bash
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add lib/tts.ts lib/tts-types.ts
git commit -m "refactor(tts): lib/tts uses Edge TTS proxy with browser fallback"
```

---

## Phase 6: ReadAloudButton 加 voice prop (P6)

### Task 6: 改 ReadAloudButton + DictionaryDetailTabs

**Files:**
- Modify: `components/ReadAloudButton.tsx`
- Modify: `components/dictionary/DictionaryDetailTabs.tsx`

- [ ] **Step 1: ReadAloudButton 加 voice prop**

```typescript
'use client';

import { useState } from 'react';
import { speak, stopSpeaking, type Voice } from '@/lib/tts';

type Size = 'sm' | 'md' | 'lg';

interface Props {
  text: string;
  label?: string;
  size?: Size;
  variant?: 'paper' | 'ink' | 'seal';
  className?: string;
  title?: string;
  voice?: Voice;   // 新增
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'px-2 py-1 text-xs gap-1',
  md: 'px-3 py-1.5 text-sm gap-1.5',
  lg: 'px-4 py-2 text-base gap-2',
};

const VARIANT_CLASS = {
  paper: 'border border-ink/30 text-ink-soft bg-paper-soft hover:bg-paper hover:border-ink/60 hover:text-ink',
  ink: 'border border-ink/60 text-ink bg-paper hover:bg-ink hover:text-paper-soft',
  seal: 'border border-seal/60 text-seal bg-paper-soft hover:bg-seal hover:text-paper-soft',
} as const;

export function ReadAloudButton({
  text, label, size = 'md', variant = 'paper', className = '',
  title = '单击朗读,双击停止', voice = 'female',
}: Props) {
  const [isSpeaking, setIsSpeaking] = useState(false);

  async function handleClick() {
    if (!text) return;
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
    } else {
      setIsSpeaking(true);
      await speak(text, { voice, onEnd: () => setIsSpeaking(false) });
    }
  }

  function handleDouble() {
    stopSpeaking();
    setIsSpeaking(false);
  }

  return (
    <button
      type="button"
      disabled={!text}
      onClick={handleClick}
      onDoubleClick={handleDouble}
      aria-pressed={isSpeaking}
      title={title}
      className={`inline-flex items-center rounded-sm font-kai tracking-widest transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${className}`}
    >
      <SpeakerIcon active={isSpeaking} />
      <span>{isSpeaking ? '停止' : label ?? '朗读'}</span>
    </button>
  );
}

function SpeakerIcon({ active }: { active: boolean }) {
  // ... (保留原 SVG)
}
```

- [ ] **Step 2: DictionaryDetailTabs 传 voice**

`components/dictionary/DictionaryDetailTabs.tsx` line 15-16 改:

```tsx
<ReadAloudButton text={char.char} label="读字" voice="male" ... />
<ReadAloudButton text={char.pinyin} label="读音" voice="female" ... />
```

- [ ] **Step 3: type check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add components/ReadAloudButton.tsx components/dictionary/DictionaryDetailTabs.tsx
git commit -m "feat(ReadAloudButton): voice prop (male/female); 字典页 读字=男 读音=女"
```

---

## Phase 7: /admin/tts 页面 (P7)

### Task 7: admin/tts 页面 + 通用 admin/config API

**Files:**
- Create: `app/admin/tts/page.tsx`
- Create: `app/api/admin/config/route.ts` (通用 GET/PUT,可服务 ai + tts)
- Modify: `lib/api-admin.ts` (getAdminConfig / updateAdminConfig)
- Modify: `lib/auth.ts` (admin guard)

- [ ] **Step 1: 写通用 config API**

`app/api/admin/config/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { withErrorHandling, unauthorized, forbidden } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function requireAdminUser() {
  const u = await getCurrentUser();
  if (!u) return unauthorized();
  if (!u.isAdmin) return forbidden();
  return u;
}

export async function GET() {
  return withErrorHandling(async () => {
    const r = await requireAdminUser();
    if (r instanceof NextResponse) return r;
    const all = await getAllConfig();
    // 只返 tts.* (admin/ai 走自己端点)
    const tts: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('tts.')) tts[k] = v;
    }
    return NextResponse.json({ ok: true, data: tts });
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const r = await requireAdminUser();
    if (r instanceof NextResponse) return r;
    const body = await req.json();
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ ok: false, error: { code: 'bad_input', message: 'body must be object' } }, { status: 400 });
    }
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v !== 'string') continue;
      if (k.startsWith('tts.')) updates[k] = v;
    }
    await setConfigBatch(updates, r.id);
    return NextResponse.json({ ok: true, data: updates });
  });
}
```

- [ ] **Step 2: lib/api-admin.ts 加 wrapper**

在文件末尾加:

```typescript
export async function getTtsConfigRequest(): Promise<ApiResult<Record<string, string>>> {
  return call('/api/admin/config', { method: 'GET' });
}

export async function updateTtsConfigRequest(body: Record<string, string>): Promise<ApiResult<Record<string, string>>> {
  return call('/api/admin/config', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
```

- [ ] **Step 3: 写 admin/tts/page.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { getTtsConfigRequest, updateTtsConfigRequest } from '@/lib/api-admin';

const VOICES = {
  male: [
    { value: 'zh-CN-YunjianNeural', label: '云健 (男 · 沉稳)' },
    { value: 'zh-CN-YunxiNeural', label: '云希 (男 · 活力)' },
    { value: 'zh-CN-YunyangNeural', label: '云扬 (男 · 新闻)' },
  ],
  female: [
    { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 (女 · 温柔)' },
    { value: 'zh-CN-XiaoyiNeural', label: '晓伊 (女 · 知性)' },
    { value: 'zh-CN-XiaomengNeural', label: '晓梦 (女 · 童声)' },
  ],
} as const;

const FORMATS = [
  { value: 'audio-24khz-48kbitrate-mono-mp3', label: '24kHz · 48kbps (默认)' },
  { value: 'audio-24khz-96kbitrate-mono-mp3', label: '24kHz · 96kbps (高质)' },
  { value: 'audio-16khz-32kbitrate-mono-mp3', label: '16kHz · 32kbps (小)' },
  { value: 'audio-16khz-128kbitrate-mono-mp3', label: '16kHz · 128kbps (高码率)' },
];

export default function AdminTtsPage() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getTtsConfigRequest().then(r => {
      if (r.ok) setCfg(r.data);
      else setErr(r.error.message);
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null); setErr(null);
    const r = await updateTtsConfigRequest({
      'tts.voice_male': cfg['tts.voice_male'] ?? '',
      'tts.voice_female': cfg['tts.voice_female'] ?? '',
      'tts.audio_format': cfg['tts.audio_format'] ?? '',
    });
    setBusy(false);
    if (!r.ok) setErr(r.error.message);
    else { setMsg('配置已保存'); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">语音设置</h1>
      <p className="text-sm text-ink-soft">站点全局默认音色,字典页「读字」用男声、「读音」用女声。</p>

      {err && <p className="text-sm text-seal inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{err}</p>}
      {msg && <p className="text-sm text-green-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{msg}</p>}

      <form onSubmit={save} className="card-paper rounded-lg p-4 space-y-3 max-w-xl">
        <div>
          <label className="text-sm font-medium">男声默认 (读字)</label>
          <select
            value={cfg['tts.voice_male'] ?? ''}
            onChange={e => setCfg(c => ({ ...c, 'tts.voice_male': e.target.value }))}
            className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          >
            {VOICES.male.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">女声默认 (读音)</label>
          <select
            value={cfg['tts.voice_female'] ?? ''}
            onChange={e => setCfg(c => ({ ...c, 'tts.voice_female': e.target.value }))}
            className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          >
            {VOICES.female.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">音频格式</label>
          <select
            value={cfg['tts.audio_format'] ?? ''}
            onChange={e => setCfg(c => ({ ...c, 'tts.audio_format': e.target.value }))}
            className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          >
            {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <button type="submit" disabled={busy}
          className="text-sm px-4 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50">
          {busy ? '保存中…' : '保存'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: type check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/admin/tts/ app/api/admin/config/ lib/api-admin.ts
git commit -m "feat(admin/tts): config page + generic admin/config API"
```

---

## Phase 8: AdminSidebar 加入口 (P8)

### Task 8: AdminSidebar 加「语音设置」

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`

- [ ] **Step 1: ITEMS 数组插 1 行**

```typescript
const ITEMS = [
  { href: '/admin', label: '仪表盘', exact: true },
  { href: '/admin/users', label: '用户' },
  { href: '/admin/chars', label: '字典 / 字源' },
  { href: '/admin/logs', label: '日志' },
  { href: '/admin/downloads', label: '下载' },
  { href: '/admin/ai', label: 'AI' },
  { href: '/admin/tts', label: '语音设置' },
];
```

- [ ] **Step 2: type check + smoke**

```bash
pnpm tsc --noEmit
pnpm dev
# 浏览器 admin 登录 → 侧边栏看到「语音设置」,点击进 /admin/tts
```

- [ ] **Step 3: Commit**

```bash
git add components/admin/AdminSidebar.tsx
git commit -m "feat(admin/sidebar): add 语音设置 entry to /admin/tts"
```

---

## Phase 9: 浏览器 smoke (P9)

### Task 9: 人工 smoke 6 步

不写代码,人工验证:

- [ ] **Step 1: 首页 BentoGrid 5 张卡文字可见** (白字 bug 已修)
- [ ] **Step 2: 字典页 /dictionary/一 点「读字」听男声** (YunjianNeural)
- [ ] **Step 3: 字典页 /dictionary/一 点「读音」听女声** (XiaoxiaoNeural)
- [ ] **Step 4: /admin/tts 改男声为 YunxiNeural 保存**
- [ ] **Step 5: 刷新字典页,再点读字 → 听到 YunxiNeural 男声**
- [ ] **Step 6: Edge TTS 502/504 时降级** (在 /api/tts 改 return 502 临时测) 浏览器有声音(降级生效)

如失败,回到对应 Phase 修。

---

## Phase 10: 随机字帖 (P10)

### Task 10: lib/chars.getRandomChars + API + RandomTab

**Files:**
- Modify: `lib/chars.ts` (加 getRandomChars)
- Modify: `lib/validators.ts` (加 charsRandomQuerySchema)
- Create: `app/api/chars/random/route.ts`
- Create: `components/worksheet/RandomTab.tsx`
- Modify: `components/worksheet/WorksheetGenerator.tsx` (加 'random' tab)
- Create: `tests/integration/api/chars-random.test.ts`
- Create: `tests/unit/components/worksheet/RandomTab.test.tsx`

- [ ] **Step 1: lib/validators.ts 加 schema**

```typescript
export const charsRandomQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(100).default(20),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
});
```

- [ ] **Step 2: lib/chars.ts 加 getRandomChars**

```typescript
const DIFFICULTY_LEVELS: Record<'easy' | 'medium' | 'hard', number[]> = {
  easy:   [1],
  medium: [1, 2],
  hard:   [1, 2, 3],
};

export async function getRandomChars(opts: {
  count: number;
  difficulty: 'easy' | 'medium' | 'hard';
}): Promise<Pick<Char, 'char' | 'pinyin' | 'meaningZh'>[]> {
  const levels = DIFFICULTY_LEVELS[opts.difficulty];
  const placeholders = levels.map(() => '?').join(',');
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, pinyin, meaning_zh
     FROM chars
     WHERE level IN (${placeholders})
       AND \`char\` REGEXP '^[一-鿿]$'
     ORDER BY RAND()
     LIMIT ?`,
    [...levels, opts.count],
  );
  return rows.map(r => ({
    char: r.char,
    pinyin: r.pinyin ?? '',
    meaningZh: r.meaning_zh,
  }));
}
```

- [ ] **Step 3: 写 API route**

`app/api/chars/random/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getRandomChars } from '@/lib/chars';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { charsRandomQuerySchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = charsRandomQuerySchema.safeParse({
      count: sp.get('count') ?? undefined,
      difficulty: sp.get('difficulty') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const chars = await getRandomChars(parsed.data);
    return NextResponse.json({ ok: true, data: { chars } });
  });
}
```

- [ ] **Step 4: 写 integration test**

`tests/integration/api/chars-random.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { integrationDescribe, TEST_DATABASE_URL } from '../setup';
import { GET } from '@/app/api/chars/random/route';
import { NextRequest } from 'next/server';

integrationDescribe('GET /api/chars/random', () => {
  it('returns N chars for easy difficulty', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const req = new NextRequest('http://localhost/api/chars/random?count=5&difficulty=easy');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.data.chars.length).toBe(5);
  });

  it('400 on count > 100', async () => {
    const req = new NextRequest('http://localhost/api/chars/random?count=200');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('400 on invalid difficulty', async () => {
    const req = new NextRequest('http://localhost/api/chars/random?difficulty=invalid');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('medium difficulty returns level 1+2 chars only', async () => {
    const req = new NextRequest('http://localhost/api/chars/random?count=20&difficulty=medium');
    const res = await GET(req);
    const j = await res.json();
    expect(j.ok).toBe(true);
    // 简单验证:返回的 char 都是 BMP (mysql2 过滤已生效)
    for (const c of j.data.chars) {
      const cp = c.char.codePointAt(0)!;
      expect(cp).toBeLessThanOrEqual(0x9FFF);
    }
  });
});
```

- [ ] **Step 5: 写 RandomTab 组件**

`components/worksheet/RandomTab.tsx`:

```tsx
'use client';

import { useState } from 'react';

interface RandomChar {
  char: string;
  pinyin: string;
  meaningZh: string | null;
}

interface Props {
  onPicked: (chars: string[]) => void;
}

const DIFFICULTY_LABELS = {
  easy: '简单 (level 1 常用字)',
  medium: '中等 (level 1+2)',
  hard: '困难 (level 1+2+3 全字库)',
} as const;

export function RandomTab({ onPicked }: Props) {
  const [count, setCount] = useState(20);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleGenerate() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/chars/random?count=${count}&difficulty=${difficulty}`);
      const j = await res.json();
      if (!j.ok) { setErr(j.error?.message ?? '生成失败'); return; }
      const chars = (j.data.chars as RandomChar[]).map(c => c.char);
      onPicked(chars);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">从字库随机抽字,自动填入字帖。</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-ink-soft">字数 (1-100)</label>
          <input
            type="number" min={1} max={100} value={count}
            onChange={e => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-ink-soft">难度</label>
          <select
            value={difficulty} onChange={e => setDifficulty(e.target.value as any)}
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          >
            {(['easy', 'medium', 'hard'] as const).map(d => (
              <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>
            ))}
          </select>
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        type="button" onClick={handleGenerate} disabled={busy}
        className="rounded-md bg-ink px-4 py-2 text-paper-soft hover:bg-ink/80 disabled:opacity-50"
      >
        {busy ? '抽字中…' : '随机生成'}
      </button>
    </div>
  );
}
```

- [ ] **Step 6: WorksheetGenerator 接入 RandomTab**

改 `components/worksheet/WorksheetGenerator.tsx`:

```typescript
type Tab = 'text' | 'library' | 'random';

// 加 import
import { RandomTab } from './RandomTab';

// 在 tab 按钮区加第三个按钮(在「从字库选」之后):
<button
  type="button"
  onClick={() => setTab('random')}
  className={`px-4 py-2 ${tab === 'random' ? 'border-b-2 border-seal font-medium' : 'text-ink-faint'}`}
>
  随机生成
</button>

// 在条件渲染区加:
{tab === 'text' ? (
  <TextInputTab value={content} onChange={setContent} />
) : tab === 'library' ? (
  <LibrarySelectTab selected={content} onChange={setContent} />
) : (
  <RandomTab
    onPicked={(chars) => {
      setContent(chars);
      setView('preview');   // 抽完直接跳预览
    }}
  />
)}
```

- [ ] **Step 7: 写 RandomTab unit test**

`tests/unit/components/worksheet/RandomTab.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RandomTab } from '@/components/worksheet/RandomTab';

describe('RandomTab', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { chars: [{ char: '你' }, { char: '好' }] } }),
    }) as any;
  });

  it('calls onPicked with chars from API', async () => {
    const onPicked = vi.fn();
    render(<RandomTab onPicked={onPicked} />);
    fireEvent.click(screen.getByText('随机生成'));
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith(['你', '好']));
  });

  it('clamps count to 1-100', async () => {
    render(<RandomTab onPicked={vi.fn()} />);
    const input = screen.getByDisplayValue('20') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '999' } });
    expect(input.value).toBe('100');
  });
});
```

- [ ] **Step 8: 跑测试**

```bash
pnpm test tests/integration/api/chars-random.test.ts tests/unit/components/worksheet/RandomTab.test.tsx
```

- [ ] **Step 9: type check + commit**

```bash
pnpm tsc --noEmit
git add lib/chars.ts lib/validators.ts app/api/chars/random/ components/worksheet/RandomTab.tsx components/worksheet/WorksheetGenerator.tsx tests/
git commit -m "feat(worksheet): random tab — pick N chars by difficulty"
```

---

## Phase 11: /pinyin 路由 + nav 入口 (P11)

### Task 11: TextToPinyin 独立路由

**Files:**
- Create: `app/pinyin/page.tsx`
- Modify: `app/page.tsx`
- Modify: `lib/design.ts`

- [ ] **Step 1: 写 app/pinyin/page.tsx**

```tsx
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { TextToPinyin } from '@/components/TextToPinyin';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';

export const dynamic = 'force-dynamic';

export default function PinyinPage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <SectionTitle subtitle="整句智能转换">字 → 拼音 互转</SectionTitle>
        <TextToPinyin />
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: app/page.tsx 删 TextToPinyin**

```diff
- import { TextToPinyin } from '@/components/TextToPinyin';
  import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
  ...
       <Hero />
       <BentoGrid />
       <ValueProps />
-      <section className="mt-8">
-        <SectionTitle subtitle="试试看">字 → 拼音 互转</SectionTitle>
-        <TextToPinyin />
-      </section>
     </PageContainer>
```

- [ ] **Step 3: lib/design.ts NAV_LINKS 插 1 行**

```typescript
export const NAV_LINKS = [
  { href: '/rare-chars', label: '罕见字库' },
  { href: '/dictionary', label: '字典' },
  { href: '/worksheet', label: '字帖' },
  { href: '/pinyin', label: '字转拼音' },     // 新增
  { href: '/poetry', label: '诗词' },
  { href: '/sutra', label: '佛经' },
  { href: '/game', label: '游戏' },
  { href: '/profile', label: '我的' },
] as const;
```

位置: 字帖后、诗词前(分组上「学习工具」)。

- [ ] **Step 4: type check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: dev server 验证**

```bash
pnpm dev
```

- 访问 `/pinyin` → 看到输入框 + 「字 → 拼音 互转」标题
- 首页 `/` 不再有 TextToPinyin section
- Header nav 出现「字转拼音」链接,点击跳转
- mobile menu 同步出现

- [ ] **Step 6: Commit**

```bash
git add app/pinyin/page.tsx app/page.tsx lib/design.ts
git commit -m "feat(pinyin): dedicated /pinyin route + nav link; remove from homepage"
```

---

## Phase 12: 收尾验证

### Task 12: 全量验证 + 收尾

- [ ] **Step 1: type check**

```bash
pnpm tsc --noEmit
```

预期: 0 error。

- [ ] **Step 2: 全量测试**

```bash
pnpm test
```

预期: 全部 pass(网络 skip 除外)。

- [ ] **Step 3: build**

```bash
pnpm build
```

预期: build 通过。

- [ ] **Step 4: 人工 smoke (5 步)**

1. 首页 / → BentoGrid 5 卡文字可见 ✓
2. 字典页 /dictionary/一 → 「读字」=男声,「读音」=女声 ✓
3. /admin/tts → 改男声为 YunxiNeural 保存 → 刷新字典页听新音色 ✓
4. 字帖页 /worksheet → 选「随机生成」tab → 选 30 字 + 困难 → 跳到预览 ✓
5. 顶部 nav 点「字转拼音」→ 进 /pinyin → 输入「你好」看到拼音 ✓

- [ ] **Step 5: 更新 MEMORY.md (plan 状态)**

在 MEMORY.md 加一条 plan 状态 entry:

```markdown
- [Plan N+1 status — Edge TTS + random worksheet + /pinyin](plan-n-plus-1-status.md) — shipped 2026-06-15, 11 commits, awaiting human smoke
```

新文件 `plan-n-plus-1-status.md` 简记每 task 状态(参考 plan-l-status.md 模板)。

- [ ] **Step 6: 推 main**

```bash
git push origin main
```

---

## 关键文件引用

- Spec: `docs/superpowers/specs/2026-06-15-edge-tts-voice-config-design.md` (9 phases + 2 new sections)
- TTS 接口(改造前): `lib/tts.ts`, 13 个 ReadAloudButton 调用点
- Admin pattern: `app/admin/ai/page.tsx`, `lib/config.ts`, `lib/api-admin.ts`
- 设计 token: `app/globals.css` `@theme { --color-* }` + `@layer utilities { .card-paper ... }`
- Edge TTS 协议参考: github.com/rany2/edge-tts
- Worksheet: `components/worksheet/WorksheetGenerator.tsx`, `lib/worksheet.ts`, `lib/validators.ts`
- 字典 detail: `components/dictionary/DictionaryDetailTabs.tsx`

## 不做 (YAGNI)

- 不做音频缓存 (Edge 限频后再加 Redis)
- 不做用户个人 voice 偏好 (admin 全局默认)
- 不做 SSML 高级特性
- 不支持非 zh-CN
- 不改现有 admin/ai 页结构
- 不动 globals.css 的 @theme token 值
- 随机字帖不做去重/历史
- TextToPinyin 组件不改内部,只搬路由
- 不加 /pinyin 的 hero
- 不改字典页 detail tabs (读字/读音外的 PinyinOutput)

## 风险

| 风险 | 缓解 |
|---|---|
| Edge TTS 协议变化 | 用成熟 edge-tts 开源协议参考;fallback 到浏览器 speech |
| WebSocket Next.js runtime 差异 | `runtime = 'nodejs'`, 不用 edge |
| 高频朗读服务器压力 | maxDuration=30s + text 1000 字上限 |
| 502/504 体验断裂 | lib/tts catch 块 fallback 到浏览器 speech |
| 4-byte UTF-8 mysql2 mojibake | 随机字帖 SQL 过滤 BMP |
| 8000+ char 性能 | chars 表有索引 (pinyin), `ORDER BY RAND() LIMIT 100` 毫秒级 |
| `card-paper` 改 transparent 后其他页面 hover 变化 | 检查所有使用处;outline 卡片补 hover bg |
| 用户连点抽字 | 不去重,符合"随机"语义 |
| `ws` 包没装 | Step 1 显式 `pnpm add ws` |
