'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';

/**
 * The /admin/ai mock mode switch.
 *
 * The current state is read on the server and handed over as props; the
 * toggle posts to /api/admin/ai/mock.
 */
export function AiMockToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    const next = !enabled;
    try {
      const res = await fetch('/api/admin/ai/mock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error?.message ?? '切换失败');
      setEnabled(Boolean(json.data?.enabled));
      setMsg(next ? '已开启 Mock 模式' : '已关闭 Mock 模式');
    } catch (e) {
      setErr((e as Error).message || '切换失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-paper rounded-lg p-4 space-y-3 max-w-xl">
      {err && <p className="text-sm text-seal">{err}</p>}
      {msg && (
        <p className="text-sm text-green-700 inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5" />
          {msg}
        </p>
      )}

      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-ink">AI Mock 模式</h2>
        <p className="text-xs text-ink-soft">
          开启后所有 LLM 调用会短路返回固定占位文本（MOCK-*），不再消耗真实 API 配额。
          适合本地开发、批量生成调试、限速回避。
        </p>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <span className={`text-sm font-medium ${enabled ? 'text-seal' : 'text-ink-soft'}`}>
          {enabled ? '已开启' : '已关闭'}
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`text-sm px-4 py-1.5 rounded disabled:opacity-50 ${
            enabled ? 'bg-paper-deep text-ink hover:bg-paper-warm' : 'bg-ink text-paper hover:bg-ink/80'
          }`}
        >
          {busy ? '切换中…' : enabled ? '关闭 Mock' : '开启 Mock'}
        </button>
      </div>
    </div>
  );
}
