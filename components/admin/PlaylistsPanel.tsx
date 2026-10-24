'use client';

import { useMemo, useState } from 'react';
import type { AudioTrack } from '@/lib/audio-tracks';
import type { Playlist, PlaylistWithTracks } from '@/lib/playlists';
import { useToastStore } from '@/lib/toast-store';
import { formatDateTime } from '@/lib/format';
import { Panel } from '@/components/admin/Panel';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';
import { ListMusic } from 'lucide-react';

/**
 * A stable empty track list.
 *
 * `playlistTracks[id] ?? []` would hand the editor a NEW array on every
 * render, which would defeat the memo below and re-filter the whole track
 * list on every keystroke.
 */
const NO_TRACKS: PlaylistWithTracks['tracks'] = [];

interface Props {
  initialPlaylists: Playlist[];
  tracks: AudioTrack[];
}

export function PlaylistsPanel({ initialPlaylists, tracks }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>(initialPlaylists);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<
    Record<number, PlaylistWithTracks['tracks']>
  >({});
  const [newTitle, setNewTitle] = useState('');
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  async function refreshList() {
    const res = await fetch('/api/admin/playlists', { cache: 'no-store' });
    const data = await res.json();
    if (data.ok) setPlaylists(data.data.playlists);
  }

  async function loadPlaylist(id: number): Promise<PlaylistWithTracks | null> {
    const res = await fetch(`/api/admin/playlists/${id}`, { cache: 'no-store' });
    const data = await res.json();
    return data.ok ? data.data.playlist : null;
  }

  async function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    const p = await loadPlaylist(id);
    if (p) setPlaylistTracks((m) => ({ ...m, [id]: p.tracks }));
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newTitle.trim()) {
      setError('请填写播放列表标题');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/playlists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), isDefault: newIsDefault }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error?.message ?? `创建失败 (${res.status})`);
        return;
      }
      setNewTitle('');
      setNewIsDefault(false);
      pushToast('success', `已新建播放列表「${newTitle.trim()}」`);
      await refreshList();
    } finally {
      setCreating(false);
    }
  }

  async function onSetDefault(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/playlists/${id}`, {
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
      await refreshList();
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
      const res = await fetch(`/api/admin/playlists/${id}`, {
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
      await refreshList();
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: number, p: Playlist) {
    if (!window.confirm(`确定删除播放列表「${p.title}」?曲目不会被删除。`)) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/playlists/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message ?? `删除失败 (${res.status})`);
        return;
      }
      pushToast('success', `已删除「${p.title}」`);
      if (expandedId === id) setExpandedId(null);
      await refreshList();
    } finally {
      setBusyId(null);
    }
  }

  async function onAddTrack(playlistId: number, trackId: number) {
    setBusyId(playlistId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trackId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error?.message ?? `添加失败 (${res.status})`);
        return;
      }
      setPlaylistTracks((m) => ({ ...m, [playlistId]: data.data.playlist.tracks }));
      pushToast('success', '已添加曲目');
    } finally {
      setBusyId(null);
    }
  }

  async function onRemoveTrack(playlistId: number, trackId: number) {
    setBusyId(playlistId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/playlists/${playlistId}/tracks?trackId=${trackId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error?.message ?? `移除失败 (${res.status})`);
        return;
      }
      setPlaylistTracks((m) => ({ ...m, [playlistId]: data.data.playlist.tracks }));
      pushToast('success', '已移除曲目');
    } finally {
      setBusyId(null);
    }
  }

  async function onMoveTrack(playlistId: number, trackId: number, direction: -1 | 1) {
    const current = playlistTracks[playlistId] ?? [];
    const idx = current.findIndex((t) => t.id === trackId);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved!);
    setPlaylistTracks((m) => ({ ...m, [playlistId]: next }));
    setBusyId(playlistId);
    try {
      const res = await fetch(`/api/admin/playlists/${playlistId}/tracks`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trackIds: next.map((t) => t.id) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message ?? `重排失败 (${res.status})`);
        // Reload to recover state
        const fresh = await loadPlaylist(playlistId);
        if (fresh) setPlaylistTracks((m) => ({ ...m, [playlistId]: fresh.tracks }));
        return;
      }
    } finally {
      setBusyId(null);
    }
  }

  const availableTracks = tracks;

  return (
    <div className="space-y-4">
      <Panel title="新建播放列表" description="给一组佛经音频编一个播放顺序">
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <FormField label="标题" htmlFor="playlist-new-title">
              <input
                id="playlist-new-title"
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="如:早课"
                className="adm-input"
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-ink pb-1.5">
              <input
                type="checkbox"
                checked={newIsDefault}
                onChange={(e) => setNewIsDefault(e.target.checked)}
              />
              <span>创建后立即设为默认</span>
            </label>
          </div>
          {error && (
            <p className="text-xs text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">
              {error}
            </p>
          )}
          <AdminButton type="submit" variant="primary" disabled={creating}>
            {creating ? '创建中…' : '新建'}
          </AdminButton>
        </form>
      </Panel>

      <Panel title={`已有播放列表 (${playlists.length})`}>
        {playlists.length === 0 ? (
          <EmptyState
            icon={ListMusic}
            title="还没有任何播放列表"
            description="在上方新建一个,给佛经音频排一个顺序。"
            className="py-8"
          />
        ) : (
          <ul className="space-y-2">
            {playlists.map((p) => (
              <li
                key={p.id}
                className={`rounded border ${
                  p.isDefault ? 'border-seal/40 bg-seal/5' : 'border-ink/15'
                }`}
              >
                <div className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(p.id)}
                    aria-label={expandedId === p.id ? '折叠' : '展开'}
                    aria-expanded={expandedId === p.id}
                    className="text-ink-soft hover:text-ink p-1"
                  >
                    {expandedId === p.id ? '▼' : '▶'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink truncate">{p.title}</span>
                      {p.isDefault && <StatusBadge tone="primary">默认</StatusBadge>}
                    </div>
                    <div className="text-xs text-ink-faint">
                      {expandedId === p.id
                        ? `${playlistTracks[p.id]?.length ?? '…'} 首`
                        : `创建于 ${formatDateTime(p.createdAt)}`}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                    {!p.isDefault && (
                      <AdminButton
                        size="sm"
                        disabled={busyId === p.id}
                        onClick={() => onSetDefault(p.id)}
                      >
                        设为默认
                      </AdminButton>
                    )}
                    <AdminButton
                      size="sm"
                      disabled={busyId === p.id}
                      onClick={() => onRename(p.id, p.title)}
                    >
                      重命名
                    </AdminButton>
                    <AdminButton
                      size="sm"
                      variant="danger"
                      disabled={busyId === p.id}
                      onClick={() => onDelete(p.id, p)}
                    >
                      删除
                    </AdminButton>
                  </div>
                </div>
                {expandedId === p.id && (
                  <PlaylistTracksEditor
                    availableTracks={availableTracks}
                    currentTracks={playlistTracks[p.id] ?? NO_TRACKS}
                    busy={busyId === p.id}
                    onAdd={(trackId) => onAddTrack(p.id, trackId)}
                    onRemove={(trackId) => onRemoveTrack(p.id, trackId)}
                    onMove={(trackId, dir) => onMoveTrack(p.id, trackId, dir)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function PlaylistTracksEditor({
  availableTracks,
  currentTracks,
  busy,
  onAdd,
  onRemove,
  onMove,
}: {
  availableTracks: AudioTrack[];
  currentTracks: PlaylistWithTracks['tracks'];
  busy: boolean;
  onAdd: (trackId: number) => void;
  onRemove: (trackId: number) => void;
  onMove: (trackId: number, direction: -1 | 1) => void;
}) {
  const [selectedTrackId, setSelectedTrackId] = useState<number>(0);
  // The addable list is derived from both track lists. Without the memo this
  // rebuilt a Set and re-filtered the whole track list on EVERY render — and
  // the editor is rendered once per expanded playlist, so N playlists meant N
  // filters of the same array.
  const addable = useMemo(() => {
    const inPlaylistIds = new Set(currentTracks.map((t) => t.id));
    return availableTracks.filter((t) => !inPlaylistIds.has(t.id));
  }, [availableTracks, currentTracks]);

  return (
    <div className="border-t border-ink/10 p-3 bg-paper-deep/25 space-y-3">
      <div>
        <div className="text-xs text-ink-soft mb-2">曲目顺序 ({currentTracks.length})</div>
        {currentTracks.length === 0 ? (
          <p className="text-xs text-ink-faint">列表为空,在下方添加曲目。</p>
        ) : (
          <ol className="space-y-1">
            {currentTracks.map((t, i) => (
              <li
                key={t.id}
                className="flex items-center gap-2 text-sm bg-paper-soft rounded px-2 py-1"
              >
                <span className="text-xs text-ink-faint tabular-nums w-6">{i + 1}.</span>
                <span className="flex-1 truncate">{t.title}</span>
                <AdminButton
                  size="sm"
                  disabled={busy || i === 0}
                  onClick={() => onMove(t.id, -1)}
                  aria-label="上移"
                >
                  ↑
                </AdminButton>
                <AdminButton
                  size="sm"
                  disabled={busy || i === currentTracks.length - 1}
                  onClick={() => onMove(t.id, 1)}
                  aria-label="下移"
                >
                  ↓
                </AdminButton>
                <AdminButton
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => onRemove(t.id)}
                >
                  移除
                </AdminButton>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex gap-2 items-end">
        <FormField label="添加曲目" htmlFor="playlist-add-track" className="flex-1">
          <select
            id="playlist-add-track"
            value={selectedTrackId}
            onChange={(e) => setSelectedTrackId(Number(e.target.value))}
            className="adm-input"
            disabled={addable.length === 0}
          >
            <option value={0}>{addable.length === 0 ? '没有可添加的曲目' : '选择…'}</option>
            {addable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </FormField>
        <AdminButton
          disabled={busy || selectedTrackId === 0}
          onClick={() => {
            if (selectedTrackId === 0) return;
            onAdd(selectedTrackId);
            setSelectedTrackId(0);
          }}
        >
          添加
        </AdminButton>
      </div>
    </div>
  );
}
