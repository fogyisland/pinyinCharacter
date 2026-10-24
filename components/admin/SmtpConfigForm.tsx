'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Check } from 'lucide-react';
import { Panel } from '@/components/admin/Panel';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';

export interface SmtpConfigInitial {
  transport: 'console' | 'smtp';
  host: string;
  port: string;
  secure: boolean;
  user: string;
  passSet: boolean;
  from: string;
  fromName: string;
}

export function SmtpConfigForm({ initial }: { initial: SmtpConfigInitial }) {
  const router = useRouter();
  const [form, setForm] = useState({
    transport: initial.transport,
    host: initial.host,
    port: initial.port,
    secure: initial.secure,
    user: initial.user,
    pass: '',
    from: initial.from,
    fromName: initial.fromName,
  });
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    setTestResult(null);
    const body: Record<string, string> = {
      'smtp.transport': form.transport,
      'smtp.host': form.host,
      'smtp.port': form.port,
      'smtp.secure': form.secure ? 'true' : 'false',
      'smtp.user': form.user,
      'smtp.from': form.from,
      'smtp.from_name': form.fromName,
    };
    if (form.pass) body['smtp.pass'] = form.pass; // empty = keep
    try {
      const res = await fetch('/api/admin/email/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '保存失败');
      setOk('配置已保存');
      setForm((f) => ({ ...f, pass: '' })); // clear pass field after save
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!testTo) {
      setTestResult({ ok: false, message: '请输入收件邮箱' });
      return;
    }
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/email/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: testTo }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '发送失败');
      setTestResult({ ok: true, message: '测试邮件已发送,请检查收件箱' });
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Panel
        title="SMTP 配置"
        description="写入 app_config 表,优先级高于 SMTP_* 环境变量。transport=console 时只把邮件内容打印到服务器日志(开发用)。"
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

          <fieldset>
            <legend className="block text-xs text-ink-soft mb-1">传输方式</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-1.5" htmlFor="smtp-transport-console">
                <input
                  id="smtp-transport-console"
                  type="radio"
                  name="transport"
                  value="console"
                  checked={form.transport === 'console'}
                  onChange={() => setForm((f) => ({ ...f, transport: 'console' }))}
                  className="h-4 w-4 accent-seal"
                />
                console(只打印)
              </label>
              <label className="flex items-center gap-1.5" htmlFor="smtp-transport-smtp">
                <input
                  id="smtp-transport-smtp"
                  type="radio"
                  name="transport"
                  value="smtp"
                  checked={form.transport === 'smtp'}
                  onChange={() => setForm((f) => ({ ...f, transport: 'smtp' }))}
                  className="h-4 w-4 accent-seal"
                />
                smtp(实际发送)
              </label>
            </div>
          </fieldset>

          <FormField label="SMTP 主机" htmlFor="smtp-host">
            <input
              id="smtp-host"
              type="text"
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              placeholder="smtp.example.com"
              className="adm-input"
            />
          </FormField>

          <div className="grid grid-cols-3 gap-2 items-start">
            <FormField label="端口" htmlFor="smtp-port">
              <input
                id="smtp-port"
                type="text"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                placeholder="587"
                className="adm-input"
              />
            </FormField>
            <FormField label="SSL/TLS (465)" htmlFor="smtp-secure" className="col-span-2">
              <input
                id="smtp-secure"
                type="checkbox"
                checked={form.secure}
                onChange={(e) => setForm((f) => ({ ...f, secure: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-seal"
              />
            </FormField>
          </div>

          <FormField label="用户名" htmlFor="smtp-user">
            <input
              id="smtp-user"
              type="text"
              value={form.user}
              onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
              className="adm-input"
            />
          </FormField>

          <FormField
            label="密码 (SMTP 密码 / 授权码)"
            htmlFor="smtp-pass"
            hint={
              form.pass ? '将覆盖现有值' : initial.passSet ? '已配置,留空不改' : '尚未配置'
            }
          >
            <span className="flex gap-1">
              <input
                id="smtp-pass"
                type={showPass ? 'text' : 'password'}
                value={form.pass}
                onChange={(e) => setForm((f) => ({ ...f, pass: e.target.value }))}
                placeholder={initial.passSet ? '(未修改)' : ''}
                className="adm-input flex-1 min-w-0"
              />
              <AdminButton
                type="button"
                variant="secondary"
                onClick={() => setShowPass((s) => !s)}
                aria-label={showPass ? '隐藏密码' : '显示密码'}
                icon={showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              />
            </span>
          </FormField>

          <FormField label="发件邮箱 (From)" htmlFor="smtp-from">
            <input
              id="smtp-from"
              type="text"
              value={form.from}
              onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
              placeholder="noreply@example.com"
              className="adm-input"
            />
          </FormField>

          <FormField label="发件人名称 (可选)" htmlFor="smtp-from-name">
            <input
              id="smtp-from-name"
              type="text"
              value={form.fromName}
              onChange={(e) => setForm((f) => ({ ...f, fromName: e.target.value }))}
              placeholder="字·韵"
              className="adm-input"
            />
          </FormField>

          <AdminButton type="submit" variant="primary" disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </AdminButton>
        </form>
      </Panel>

      <Panel
        title="发送测试邮件"
        description="使用上方保存的配置发送一封测试邮件到指定收件人,验证 SMTP 设置是否正确。"
      >
        <div className="space-y-3">
          <FormField label="收件邮箱" htmlFor="smtp-test-to">
            <span className="flex gap-2">
              <input
                id="smtp-test-to"
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="your@email.com"
                className="adm-input flex-1 min-w-0"
              />
              <AdminButton
                type="button"
                variant="secondary"
                onClick={sendTest}
                disabled={testBusy || !testTo}
              >
                {testBusy ? '发送中…' : '发送'}
              </AdminButton>
            </span>
          </FormField>
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
