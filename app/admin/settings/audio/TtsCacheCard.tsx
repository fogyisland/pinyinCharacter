'use client';

import { useEffect, useState } from 'react';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function TtsCacheCard() {
  const [count, setCount] = useState<number | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const res = await fetch('/api/admin/tts-cache');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setCount(body.data.count);
      setBytes(body.data.bytes);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleClear() {
    if (!confirm('确认清除全部 TTS 音频缓存？下次播放将重新合成。')) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/tts-cache', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-paper p-4 mt-4">
      <h2 className="text-sm font-semibold text-ink mb-2">TTS 音频缓存</h2>
      <p className="text-xs text-ink-soft mb-3">
        客户端缓存 (Cache API · tts-v1)。每个用户的缓存相互独立，仅统计当前浏览器。
      </p>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {count === null ? (
        <p className="text-xs text-ink-faint">加载中…</p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-ink">
            <span className="font-medium">{count}</span> 条 · <span className="font-medium">{formatBytes(bytes ?? 0)}</span>
          </div>
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="rounded border border-seal text-seal px-3 py-1 text-sm hover:bg-seal/10 disabled:opacity-50"
          >
            {busy ? '清除中…' : '清除缓存'}
          </button>
        </div>
      )}
    </div>
  );
}
