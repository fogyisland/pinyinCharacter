'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, AlertTriangle, ExternalLink, Wifi } from 'lucide-react';
import {
  getAdminPayPalConfigRequest,
  updateAdminPayPalConfigRequest,
  testPayPalConnectionRequest,
} from '@/lib/api-admin';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { LoadingState } from '@/components/admin/LoadingState';
import { FormField } from '@/components/admin/FormField';
import { AdminButton, AdminLink } from '@/components/admin/AdminButton';

export default function AdminPayPalConfigPage() {
  const [cfg, setCfg] = useState<{
    mode: 'sandbox' | 'live';
    hasClientId: boolean;
    hasSecret: boolean;
    hasWebhookId: boolean;
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
    setMsg(null);
    setErr(null);
    const r = await getAdminPayPalConfigRequest();
    if (r.ok) setCfg(r.data);
    else setErr(r.error.message);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setMsg(null);
      setErr(null);
      const body: any = {};
      if (cfg) body.mode = cfg.mode;
      if (clientId) body.clientId = clientId;
      if (clientSecret) body.clientSecret = clientSecret;
      if (webhookId) body.webhookId = webhookId;
      const r = await updateAdminPayPalConfigRequest(body);
      setBusy(false);
      if (!r.ok) {
        setErr(r.error.message);
        return;
      }
      setMsg(`已保存 (${r.data.changed.join(', ')})`);
      setClientId('');
      setClientSecret('');
      setWebhookId('');
      load();
    },
    [cfg, clientId, clientSecret, webhookId, load],
  );

  const onTest = useCallback(async () => {
    setTesting(true);
    setMsg(null);
    setErr(null);
    const r = await testPayPalConnectionRequest();
    setTesting(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    setMsg(r.data.message);
  }, []);

  if (!cfg) {
    return (
      <div>
        <PageHeader
          title="支付配置 (PayPal)"
          description="填写 PayPal 应用凭据并选择运行模式。已配置的项留空表示不修改。"
          actions={
            <AdminLink href="/admin/memberships" variant="ghost">
              ← 返回会员列表
            </AdminLink>
          }
        />
        <Panel className="max-w-2xl">
          <LoadingState description="正在读取 PayPal 应用凭据。" />
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="支付配置 (PayPal)"
        description="填写 PayPal 应用凭据并选择运行模式。已配置的项留空表示不修改。"
        actions={
          <AdminLink href="/admin/memberships" variant="ghost">
            ← 返回会员列表
          </AdminLink>
        }
      />

      <Panel
        title="PayPal 配置"
        description="凭据写入 app_config 表,会员开通与订单校验都读这里。"
        className="max-w-2xl"
      >
        <div className="space-y-4">
          {err && (
            <p className="text-sm text-danger inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {err}
            </p>
          )}
          {msg && (
            <p className="text-sm text-success inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5" />
              {msg}
            </p>
          )}

          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-soft">状态:</span>
            {cfg.hasClientId && cfg.hasSecret && cfg.hasWebhookId ? (
              <span className="text-success inline-flex items-center gap-1">
                <Check className="h-3.5 w-3.5" />
                已配置
              </span>
            ) : (
              <span className="text-seal inline-flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                未完整
              </span>
            )}
            <AdminButton
              type="button"
              onClick={onTest}
              disabled={testing}
              size="sm"
              variant="secondary"
              icon={<Wifi className="h-3 w-3" />}
              className="ml-auto"
            >
              {testing ? '测试中…' : '测试连接'}
            </AdminButton>
          </div>

          <form onSubmit={onSave} className="space-y-3">
            <fieldset>
              <legend className="block text-xs text-ink-soft mb-1">模式</legend>
              <div className="flex gap-3 mt-1">
                {(['sandbox', 'live'] as const).map((m) => (
                  <label key={m} className="flex items-center gap-1 text-sm">
                    <input
                      type="radio"
                      checked={cfg.mode === m}
                      onChange={() => setCfg({ ...cfg, mode: m })}
                    />
                    {m === 'sandbox' ? 'Sandbox (测试)' : 'Live (生产)'}
                  </label>
                ))}
              </div>
            </fieldset>

            <FormField label={`Client ID ${cfg.hasClientId ? '(已配置,留空不改)' : ''}`}>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="adm-input"
              />
            </FormField>

            <FormField label={`Client Secret ${cfg.hasSecret ? '(已配置,留空不改)' : ''}`}>
              <input
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                type="password"
                className="adm-input"
              />
            </FormField>

            <FormField label={`Webhook ID ${cfg.hasWebhookId ? '(已配置,留空不改)' : ''}`}>
              <input
                value={webhookId}
                onChange={(e) => setWebhookId(e.target.value)}
                className="adm-input"
              />
            </FormField>

            <div>
              <div className="text-xs text-ink-soft mb-1">Webhook URL (PayPal 后台填这个)</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-paper-deep px-2 py-1 rounded font-mono">
                  {cfg.webhookUrl}
                </code>
                <a
                  href="https://developer.paypal.com/dashboard/applications"
                  target="_blank"
                  rel="noopener"
                  className="text-xs text-seal hover:underline inline-flex items-center gap-1"
                >
                  PayPal 后台
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            <AdminButton type="submit" variant="primary" disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </AdminButton>
          </form>
        </div>
      </Panel>
    </div>
  );
}
