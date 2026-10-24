'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Panel } from '@/components/admin/Panel';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';

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
    setBusy(true);
    setErr(null);
    setOk(null);
    setTestResult(null);
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
    <div className="space-y-4 max-w-2xl">
      <Panel
        title="站点 URL"
        description="写入 app_config.site.url。用于 sitemap、robots、canonical、JSON-LD。"
      >
        <form onSubmit={save} className="space-y-3">
          {err && (
            <p className="text-sm text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">
              {err}
            </p>
          )}
          {ok && (
            <p className="text-sm text-success inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5" />
              {ok}
            </p>
          )}

          <FormField
            label="站点 URL"
            htmlFor="site-url"
            hint={
              <>
                当前来源:{' '}
                <code>{initial.source === 'app_config' ? '数据库' : '环境变量'}</code>。
              </>
            }
          >
            <input
              id="site-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://pinyin.example.com"
              className="adm-input"
            />
          </FormField>

          <AdminButton type="submit" variant="primary" disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </AdminButton>
        </form>
      </Panel>

      <Panel
        title="测试访问"
        description="仅做客户端格式校验(必须是 http(s) 开头且不超过 256 字符)。完整可达性请用浏览器实际访问。"
      >
        <div className="space-y-3">
          <AdminButton type="button" variant="secondary" onClick={testAccess}>
            测试访问
          </AdminButton>
          {testResult && (
            <p className={`text-sm ${testResult.ok ? 'text-success' : 'text-danger'}`}>
              {testResult.message}
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
