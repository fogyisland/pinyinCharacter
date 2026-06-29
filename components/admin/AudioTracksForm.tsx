'use client';

import { useState } from 'react';
import type { AudioTrack } from '@/lib/audio-tracks';
import { useToastStore } from '@/lib/toast-store';

interface Props {
  initialTracks: AudioTrack[];
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function AudioTracksForm({ initialTracks }: Props) {
  const [tracks, setTracks] = useState<AudioTrack[]>(initialTracks);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  async function refresh() {
    const res = await fetch('/api/admin/audio', { cache: 'no-store' });
    const data = await res.json();
    if (data.ok) setTracks(data.data.tracks);
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) { setError('请选择 MP3 文件'); return; }
    if (!title.trim()) { setError('请填写标题'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('title', title.trim());
      if (isDefault) fd.set('isDefault', 'true');
      const res = await fetch('/api/admin/audio', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error?.message ?? `上传失败 (${res.status})`);
        return;
      }
      setTitle('');
      setFile(null);
      setIsDefault(false);
      // Reset the file input so the same file can be re-selected after error.
      const input = document.getElementById('audio-file-input') as HTMLInputElement | null;
      if (input) input.value = '';
      pushToast('success', `已上传「${data.data.track.title}」`);
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  async function onSetDefault(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/audio/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message ?? `设置默认失败 (${res.status})`);
        return;
      }
      pushToast('success', '已设为默认');
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function onRename(id: number, currentTitle: string) {
    const next = window.prompt('新标题', currentTitle);
    if (!next || !next.trim() || next.trim() === currentTitle) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/audio/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: next.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message ?? `重命名失败 (${res.status})`);
        return;
      }
      pushToast('success', '已重命名');
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: number, t: AudioTrack) {
    if (!window.confirm(`确定删除「${t.title}」?文件也会从服务器删除。`)) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/audio/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message ?? `删除失败 (${res.status})`);
        return;
      }
      pushToast('success', `已删除「${t.title}」`);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={onUpload} className="border border-ink/20 rounded-md p-4 space-y-3 bg-paper-warm/40">
        <h2 className="text-sm font-semibold text-ink">上传新音频</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-ink-soft">标题</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如:大悲咒"
              className="mt-1 block w-full rounded border border-ink/30 bg-paper px-2 py-1 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-soft">MP3 文件 (≤ 50 MB)</span>
            <input
              id="audio-file-input"
              type="file"
              accept="audio/mpeg,.mp3"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          上传后立即设为默认
        </label>
        {error && <p className="text-xs text-seal">{error}</p>}
        <button
          type="submit"
          disabled={uploading}
          className="text-sm px-4 py-1.5 bg-seal text-paper rounded hover:bg-seal/90 disabled:opacity-50"
        >
          {uploading ? '上传中…' : '上传'}
        </button>
      </form>

      <div>
        <h2 className="text-sm font-semibold text-ink mb-3">已上传 ({tracks.length})</h2>
        {tracks.length === 0 ? (
          <p className="text-sm text-ink-soft">还没有任何音频。</p>
        ) : (
          <ul className="space-y-2">
            {tracks.map((t) => (
              <li
                key={t.id}
                className={`flex items-center gap-3 p-3 rounded border ${
                  t.isDefault ? 'border-seal bg-seal/5' : 'border-ink/20'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink truncate">{t.title}</span>
                    {t.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-seal text-paper rounded">默认</span>
                    )}
                  </div>
                  <div className="text-xs text-ink-faint mt-0.5">
                    {t.filename} · {fmtBytes(t.sizeBytes)} · 上传于 {new Date(t.createdAt).toLocaleString('zh-CN')}
                  </div>
                  <audio src={`/audio/${t.filename}`} controls preload="none" className="mt-1 h-8 w-full max-w-md" />
                </div>
                <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                  {!t.isDefault && (
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => onSetDefault(t.id)}
                      className="text-xs px-2 py-1 border border-ink/30 rounded hover:bg-paper-warm disabled:opacity-50"
                    >
                      设为默认
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => onRename(t.id, t.title)}
                    className="text-xs px-2 py-1 border border-ink/30 rounded hover:bg-paper-warm disabled:opacity-50"
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => onDelete(t.id, t)}
                    className="text-xs px-2 py-1 border border-seal/50 text-seal rounded hover:bg-seal/10 disabled:opacity-50"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
