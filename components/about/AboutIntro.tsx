'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Sparkles, Loader2 } from 'lucide-react';

export function AboutIntro({
  initialText,
  initialGeneratedAt,
  isAi,
  isAdmin,
}: {
  initialText: string;
  initialGeneratedAt: string | null;
  isAi: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [text, setText] = useState(initialText);
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function regenerate() {
    if (!confirm('重新生成项目介绍?会调用 LLM 并覆盖当前内容。')) return;
    setBusy(true); setErr(null); setOkMsg(null);
    try {
      const res = await fetch('/api/admin/about/intro', { method: 'POST' });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '生成失败');
      setText(j.data.text);
      setGeneratedAt(j.data.generatedAt);
      setOkMsg(`已重新生成 (${j.data.durationMs}ms)`);
      startTransition(() => router.refresh());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());

  return (
    <section className="card-paper rounded-lg p-6 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-ink inline-flex items-center gap-1.5">
          {isAi
            ? <><Sparkles className="h-4 w-4 text-seal" />项目介绍 (AI 生成)</>
            : <>项目介绍</>}
        </h2>
        {isAdmin && (
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            className="text-xs px-3 py-1.5 border border-ink/20 rounded hover:bg-paper-deep disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />生成中…</>
              : <><RefreshCw className="h-3.5 w-3.5" />{isAi ? '重新生成' : 'AI 生成'}</>}
          </button>
        )}
      </div>

      {generatedAt && (
        <p className="text-xs text-ink-faint">
          生成时间: {new Date(generatedAt).toLocaleString('zh-CN')}
        </p>
      )}

      {err && <p className="text-sm text-seal">{err}</p>}
      {okMsg && <p className="text-sm text-green-700">{okMsg}</p>}

      <div className="prose prose-sm max-w-none text-ink-soft space-y-3">
        {paragraphs.map((p, i) => (
          <p key={i} className="leading-relaxed whitespace-pre-wrap">{p}</p>
        ))}
      </div>
    </section>
  );
}