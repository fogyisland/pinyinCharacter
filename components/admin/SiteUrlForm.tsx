'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';

export interface SiteUrlFormInitial {
  url: string;
  source: 'app_config' | 'env';
}

function isValidUrl(v: string): boolean {
  return /^https?:\/\//.test(v) && v.length <= 256;
}

export function SiteUrlForm({ initial }: { initial: SiteUrlFormInitial }) {
  const router = useRouter();
  const [url, setUrl] = useState(initial.url);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setOk(null); setTestResult(null);
    const trimmed = url.trim();
    if (!isValidUrl(trimmed)) {
      setErr('URL 必须以 http:// 或 https:// 开头, 且不超过 256 字符');
      setBusy(false);
      return;
    }
    try {
      const res = await fetch('/api/admin/site-url', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '保存失败');
      setOk('站点 URL 已保存');
      setUrl(j.data.url);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function testAccess() {
    const trimmed = url.trim();
    if (!isValidUrl(trimmed)) {
      setTestResult({ ok: false, message: 'URL 格式不合法,无法测试' });
      return;
    }
    setTestResult({ ok: true, message: `URL 格式有效: ${trimmed}` });
  }

  return (
    <div className="space-y-6 max-w-xl">
      <form onSubmit={save} className="card-paper rounded-lg p-4 space-y-3">
        {err && <p className="text-sm text-seal">{err}</p>}
        {ok && (
          <p className="text-sm text-green-700 inline-flex items-center gap-1">
            <Check className="h-3.5 w-3.5" />{ok}
          </p>
        )}

        <div>
          <label className="text-sm font-medium">站点 URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://pinyin.example.com"
            className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          />
          <p className="text-xs text-ink-soft mt-1">
            写入 <code>app_config.site.url</code>。用于 sitemap、robots、canonical、JSON-LD。
            当前来源: <code>{initial.source === 'app_config' ? '数据库' : '环境变量'}</code>。
          </p>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="text-sm px-4 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </form>

      <div className="card-paper rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-ink">测试访问</h2>
        <p className="text-xs text-ink-soft">
          仅做客户端格式校验(必须是 http(s) 开头且不超过 256 字符)。完整可达性请用浏览器实际访问。
        </p>
        <button
          type="button"
          onClick={testAccess}
          className="text-sm px-3 py-1.5 border border-ink/20 rounded hover:bg-paper-deep"
        >
          测试访问
        </button>
        {testResult && (
          <p className={`text-sm ${testResult.ok ? 'text-green-700' : 'text-seal'}`}>
            {testResult.message}
          </p>
        )}
      </div>
    </div>
  );
}
