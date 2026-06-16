'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Check, AlertTriangle, ExternalLink, Wifi } from 'lucide-react';
import { getAdminPayPalConfigRequest, updateAdminPayPalConfigRequest, testPayPalConnectionRequest } from '@/lib/api-admin';

export default function AdminPayPalConfigPage() {
  const [cfg, setCfg] = useState<{
    mode: 'sandbox' | 'live';
    hasClientId: boolean; hasSecret: boolean; hasWebhookId: boolean;
    webhookUrl: string;
  } | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [webhookId, setWebhookId] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMsg(null); setErr(null);
    const r = await getAdminPayPalConfigRequest();
    if (r.ok) setCfg(r.data);
    else setErr(r.error.message);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null); setErr(null);
    const body: any = {};
    if (cfg) body.mode = cfg.mode;
    if (clientId) body.clientId = clientId;
    if (clientSecret) body.clientSecret = clientSecret;
    if (webhookId) body.webhookId = webhookId;
    const r = await updateAdminPayPalConfigRequest(body);
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setMsg(`已保存 (${r.data.changed.join(', ')})`);
    setClientId(''); setClientSecret(''); setWebhookId('');
    load();
  }, [cfg, clientId, clientSecret, webhookId, load]);

  const onTest = useCallback(async () => {
    setTesting(true); setMsg(null); setErr(null);
    const r = await testPayPalConnectionRequest();
    setTesting(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setMsg(r.data.message);
  }, []);

  if (!cfg) return <p className="text-sm text-ink-faint">加载中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">支付配置 (PayPal)</h1>
        <Link href="/admin/memberships" className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">← 返回会员列表</Link>
      </div>

      <div className="card-paper rounded-lg p-4 space-y-4 max-w-2xl">
        {err && <p className="text-sm text-seal inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{err}</p>}
        {msg && <p className="text-sm text-green-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{msg}</p>}

        <div className="flex items-center gap-3 text-sm">
          <span className="text-ink-soft">状态:</span>
          {cfg.hasClientId && cfg.hasSecret && cfg.hasWebhookId
            ? <span className="text-green-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />已配置</span>
            : <span className="text-seal inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />未完整</span>}
          <button type="button" onClick={onTest} disabled={testing}
            className="ml-auto text-xs px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep inline-flex items-center gap-1">
            <Wifi className="h-3 w-3" />{testing ? '测试中…' : '测试连接'}
          </button>
        </div>

        <form onSubmit={onSave} className="space-y-3">
          <div>
            <label className="text-sm font-medium">模式</label>
            <div className="flex gap-3 mt-1">
              {(['sandbox', 'live'] as const).map(m => (
                <label key={m} className="flex items-center gap-1 text-sm">
                  <input type="radio" checked={cfg.mode === m} onChange={() => setCfg({ ...cfg, mode: m })} />
                  {m === 'sandbox' ? 'Sandbox (测试)' : 'Live (生产)'}
                </label>
              ))}
            </div>
          </div>
          <Field label={`Client ID ${cfg.hasClientId ? '(已配置,留空不改)' : ''}`}>
            <input value={clientId} onChange={e => setClientId(e.target.value)} className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
          </Field>
          <Field label={`Client Secret ${cfg.hasSecret ? '(已配置,留空不改)' : ''}`}>
            <input value={clientSecret} onChange={e => setClientSecret(e.target.value)} type="password" className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
          </Field>
          <Field label={`Webhook ID ${cfg.hasWebhookId ? '(已配置,留空不改)' : ''}`}>
            <input value={webhookId} onChange={e => setWebhookId(e.target.value)} className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
          </Field>
          <div>
            <label className="text-sm font-medium">Webhook URL (PayPal 后台填这个)</label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 text-xs bg-paper-deep px-2 py-1 rounded font-mono">{cfg.webhookUrl}</code>
              <a href="https://developer.paypal.com/dashboard/applications" target="_blank" rel="noopener"
                className="text-xs text-seal hover:underline inline-flex items-center gap-1">
                PayPal 后台<ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          <button type="submit" disabled={busy}
            className="text-sm px-4 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50">
            {busy ? '保存中…' : '保存'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
