'use client';

import { useEffect, useState } from 'react';
import { AdminButton } from '@/components/admin/AdminButton';
import { LoadingState } from '@/components/admin/LoadingState';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

const TTS_CACHE_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error('请求超时（5s）')), ms),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function TtsCacheCard() {
  const [count, setCount] = useState<number | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const res = await fetchWithTimeout('/api/admin/tts-cache', {}, TTS_CACHE_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setCount(body.data.count);
      setBytes(body.data.bytes);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleClear() {
    if (!confirm('确认清除全部 TTS 音频缓存？下次播放将重新合成。')) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchWithTimeout(
        '/api/admin/tts-cache',
        { method: 'DELETE' },
        TTS_CACHE_TIMEOUT_MS,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {err && (
        <p className="text-xs text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">
          {err}
        </p>
      )}
      {count === null ? (
        <LoadingState variant="inline" label="正在统计缓存…" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ink">
            <span className="font-medium">{count}</span> 条 ·{' '}
            <span className="font-medium">{formatBytes(bytes ?? 0)}</span>
          </div>
          <AdminButton type="button" variant="danger" onClick={handleClear} disabled={busy}>
            {busy ? '清除中…' : '清除缓存'}
          </AdminButton>
        </div>
      )}
    </div>
  );
}
