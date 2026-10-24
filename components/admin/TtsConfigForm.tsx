'use client';

import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { updateTtsConfigRequest } from '@/lib/api-admin';

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

/**
 * The /admin/tts settings form.
 *
 * The values are read on the server and handed over as props, so opening the
 * page needs no extra request. Saving goes through the existing admin API.
 */
export function TtsConfigForm({
  initialVoiceMale,
  initialVoiceFemale,
  initialFormat,
}: {
  initialVoiceMale: string;
  initialVoiceFemale: string;
  initialFormat: string;
}) {
  const [voiceMale, setVoiceMale] = useState(initialVoiceMale);
  const [voiceFemale, setVoiceFemale] = useState(initialVoiceFemale);
  const [format, setFormat] = useState(initialFormat);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const result = await updateTtsConfigRequest({
        'tts.voice_male': voiceMale,
        'tts.voice_female': voiceFemale,
        'tts.audio_format': format,
      });
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      setMsg('配置已保存');
    } catch (e) {
      setErr((e as Error).message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {err && (
        <p className="text-sm text-seal inline-flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5" />
          {err}
        </p>
      )}
      {msg && (
        <p className="text-sm text-green-700 inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5" />
          {msg}
        </p>
      )}

      <form onSubmit={save} className="card-paper rounded-lg p-4 space-y-3 max-w-xl">
        <div>
          <label className="text-sm font-medium" htmlFor="tts-voice-male">
            男声默认 (读字)
          </label>
          <select
            id="tts-voice-male"
            value={voiceMale}
            onChange={(e) => setVoiceMale(e.target.value)}
            className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          >
            {TTS_MALE_VOICES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="tts-voice-female">
            女声默认 (读音)
          </label>
          <select
            id="tts-voice-female"
            value={voiceFemale}
            onChange={(e) => setVoiceFemale(e.target.value)}
            className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          >
            {TTS_FEMALE_VOICES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="tts-audio-format">
            音频格式
          </label>
          <select
            id="tts-audio-format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          >
            {TTS_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="text-sm px-4 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </form>
    </>
  );
}
