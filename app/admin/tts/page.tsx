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
