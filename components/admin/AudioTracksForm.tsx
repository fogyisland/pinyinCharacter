'use client';

import { useState } from 'react';
import type { AudioTrack } from '@/lib/audio-tracks';
import { useToastStore } from '@/lib/toast-store';
import { formatDateTime } from '@/lib/format';
import { Panel } from '@/components/admin/Panel';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';
import { AudioLines } from 'lucide-react';

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
    if (!file) {
      setError('请选择 MP3 文件');
      return;
    }
    if (!title.trim()) {
      setError('请填写标题');
      return;
    }
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
    <div className="space-y-4">
      <Panel title="上传新音频" description="MP3 文件,单个不超过 50 MB">
        <form onSubmit={onUpload} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="标题" htmlFor="audio-title">
              <input
                id="audio-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="如:大悲咒"
                className="adm-input"
              />
            </FormField>
            <FormField label="MP3 文件 (≤ 50 MB)" htmlFor="audio-file-input">
              <input
                id="audio-file-input"
                type="file"
                accept="audio/mpeg,.mp3"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            上传后立即设为默认
          </label>
          {error && (
            <p className="text-xs text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">
              {error}
            </p>
          )}
          <AdminButton type="submit" variant="primary" disabled={uploading}>
            {uploading ? '上传中…' : '上传'}
          </AdminButton>
        </form>
      </Panel>

      <Panel title={`已上传 (${tracks.length})`}>
        {tracks.length === 0 ? (
          <EmptyState
            icon={AudioLines}
            title="还没有任何音频"
            description="上传一段佛经音频,之后就能在播放列表里排顺序。"
            className="py-8"
          />
        ) : (
          <ul className="space-y-2">
            {tracks.map((t) => (
              <li
                key={t.id}
                className={`flex items-center gap-3 p-3 rounded border ${
                  t.isDefault ? 'border-seal/40 bg-seal/5' : 'border-ink/15'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink truncate">{t.title}</span>
                    {t.isDefault && <StatusBadge tone="primary">默认</StatusBadge>}
                  </div>
                  <div className="text-xs text-ink-faint mt-0.5">
                    {t.filename} · {fmtBytes(t.sizeBytes)} · 上传于{' '}
                    {formatDateTime(t.createdAt)}
                  </div>
                  <audio
                    src={`/audio/${t.filename}`}
                    controls
                    preload="none"
                    className="mt-1 h-8 w-full max-w-md"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                  {!t.isDefault && (
                    <AdminButton
                      size="sm"
                      disabled={busyId === t.id}
                      onClick={() => onSetDefault(t.id)}
                    >
                      设为默认
                    </AdminButton>
                  )}
                  <AdminButton
                    size="sm"
                    disabled={busyId === t.id}
                    onClick={() => onRename(t.id, t.title)}
                  >
                    重命名
                  </AdminButton>
                  <AdminButton
                    size="sm"
                    variant="danger"
                    disabled={busyId === t.id}
                    onClick={() => onDelete(t.id, t)}
                  >
                    删除
                  </AdminButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
