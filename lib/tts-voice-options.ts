/**
 * The TTS option lists shared by the admin settings form and its server page.
 *
 * This module is deliberately **dependency-free**: no `'use client'`, no React
 * import, no imports at all. Both the client form (`components/admin/
 * TtsConfigForm.tsx`) and the server page (`app/admin/tts/page.tsx`) read the
 * lists from here.
 *
 * Why not `lib/tts-config.ts`? That module imports `lib/config.ts` → `lib/db.ts`
 * (mysql2), so a client component importing it would pull the DB layer into the
 * browser bundle.
 *
 * Why not keep them in the client component? In the App Router every export of a
 * `'use client'` module becomes a *client reference* on the server. A component
 * export renders; a **data** export does not — the server receives a proxy whose
 * array indices are `undefined`, so `TTS_MALE_VOICES[0].value` throws
 * `TypeError: Cannot read properties of undefined (reading 'value')`.
 *
 * The first entry of each list must match the DB defaults in `lib/tts-config.ts`
 * (`DEFAULTS`); the unit test pins both sides together so they cannot drift.
 */
export const TTS_MALE_VOICES = [
  { value: 'zh-CN-YunjianNeural', label: '云健 (男 · 沉稳)' },
  { value: 'zh-CN-YunxiNeural', label: '云希 (男 · 活力)' },
  { value: 'zh-CN-YunyangNeural', label: '云扬 (男 · 新闻)' },
] as const;

export const TTS_FEMALE_VOICES = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 (女 · 温柔)' },
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊 (女 · 知性)' },
  { value: 'zh-CN-XiaomengNeural', label: '晓梦 (女 · 童声)' },
] as const;

export const TTS_FORMATS = [
  { value: 'audio-24khz-48kbitrate-mono-mp3', label: '24kHz · 48kbps (默认)' },
  { value: 'audio-24khz-96kbitrate-mono-mp3', label: '24kHz · 96kbps (高质)' },
  { value: 'audio-16khz-32kbitrate-mono-mp3', label: '16kHz · 32kbps (小)' },
  { value: 'audio-16khz-128kbitrate-mono-mp3', label: '16kHz · 128kbps (高码率)' },
] as const;
