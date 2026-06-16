'use client';

import { useState, useCallback, useTransition } from 'react';

interface DbStats {
  byLevel: { level: number; n: number }[];
  withStory: number;
  rare: { total: number; withMeaning: number; withStory: number };
  dict: { zh: number; en: number; alt: number; var: number };
}

export function InitCharsPanel({
  initialMock,
  initialModel,
  initialBaseUrl,
  stats,
}: {
  initialMock: boolean;
  initialModel: string;
  initialBaseUrl: string;
  stats: DbStats;
}) {
  const [mockOn, setMockOn] = useState(initialMock);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [, startTransition] = useTransition();

  // Re-fetch stats on demand (after seed/clear)
  const refreshStats = useCallback(async () => {
    startTransition(() => setRefreshKey((k) => k + 1));
  }, []);

  async function postJson<T>(url: string, body: object): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error?.message ?? '请求失败');
    return j.data;
  }

  async function toggleMock(next: boolean) {
    setBusy('mock'); setMsg(null);
    try {
      await postJson('/api/admin/ai/mock', { enabled: next });
      setMockOn(next);
      setMsg({ kind: 'ok', text: `Mock LLM 已${next ? '开启' : '关闭'}` });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function seed() {
    if (!confirm('确认:会先清空 20 个种子字符,再重新插入。')) return;
    setBusy('seed'); setMsg(null);
    try {
      const d = await postJson<{ inserted: number; adminUser: string; adminPass: string }>(
        '/api/admin/chars/init/seed',
        { action: 'seed' },
      );
      setMsg({ kind: 'ok', text: `已插入 ${d.inserted} 字符,admin: ${d.adminUser}/${d.adminPass}` });
      await refreshStats();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    if (!confirm('确认:会删除 20 个种子字符 + 1 个 admin 用户。')) return;
    setBusy('clear'); setMsg(null);
    try {
      const d = await postJson<{ removed: number }>(
        '/api/admin/chars/init/seed',
        { action: 'clear' },
      );
      setMsg({ kind: 'ok', text: `已删除 ${d.removed} 字符 + admin 用户` });
      await refreshStats();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  // The stats object is re-read on each render triggered by refreshKey via the
  // parent (the page is a server component — we just trigger a router refresh
  // by clicking through to the page).
  return (
    <div className="space-y-4" data-refresh={refreshKey}>
      {/* DB state */}
      <div className="card-paper rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink-soft">数据库状态 (本地 piyin_dev)</h3>
          <button
            type="button"
            onClick={refreshStats}
            className="text-xs px-2 py-1 rounded border border-ink/20 hover:bg-paper-warm"
          >
            刷新
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {stats.byLevel.map((l) => (
            <div key={l.level} className="border border-paper-warm rounded p-2">
              <div className="text-xs text-ink-soft">L{l.level}</div>
              <div className="text-lg font-serif">{l.n}</div>
            </div>
          ))}
          <div className="border border-paper-warm rounded p-2">
            <div className="text-xs text-ink-soft">字源故事</div>
            <div className="text-lg font-serif">{stats.withStory}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-ink-soft">
          <div>释义(中): {stats.dict.zh}</div>
          <div>释义(英): {stats.dict.en}</div>
          <div>多音: {stats.dict.alt}</div>
          <div>异体: {stats.dict.var}</div>
          <div>罕见字: {stats.rare.total} (释义 {stats.rare.withMeaning} / 故事 {stats.rare.withStory})</div>
        </div>
      </div>

      {/* Mock LLM toggle */}
      <div className="card-paper rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-ink-soft">Mock LLM (不调用真实 API)</h3>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mockOn}
              disabled={busy !== null}
              onChange={(e) => toggleMock(e.target.checked)}
            />
            <span className={`text-sm font-medium ${mockOn ? 'text-seal' : 'text-ink-soft'}`}>
              {mockOn ? '已开启 (返回 MOCK-*)' : '关闭 (走真实 LLM)'}
            </span>
          </label>
        </div>
        <div className="text-xs text-ink-soft space-y-0.5">
          <div>当前模型: <code>{initialModel || '<未设置>'}</code></div>
          <div>当前 base URL: <code>{initialBaseUrl || '<未设置>'}</code></div>
        </div>
      </div>

      {/* Seed / Clear */}
      <div className="card-paper rounded-lg p-4">
        <h3 className="text-sm font-semibold text-ink-soft mb-2">种子数据 (20 字符 + 1 admin)</h3>
        <p className="text-xs text-ink-soft mb-3">
          10 个 L1 (龜龠龥齉靐龘齾齼龗龍) + 5 个 L2 (䶮䶲䶳䶴䶸) + 5 个 L3/罕见字 (䨻䨷䨈䨁䨂)。所有字符都是 BMP 罕用字,不会和真实数据冲突。
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={seed}
            disabled={busy !== null}
            className="text-sm px-4 py-2 rounded bg-ink text-paper hover:bg-ink/80 disabled:opacity-50"
          >
            {busy === 'seed' ? '种入中…' : '重置 + 种入'}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={busy !== null}
            className="text-sm px-4 py-2 rounded border border-ink/30 hover:bg-ink/10 disabled:opacity-50"
          >
            {busy === 'clear' ? '清空中…' : '清空种子'}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`p-3 rounded text-sm ${msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
