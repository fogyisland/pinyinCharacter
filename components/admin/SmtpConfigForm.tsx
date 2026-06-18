'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Check } from 'lucide-react';

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
    setBusy(true); setErr(null); setOk(null); setTestResult(null);
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
      setForm(f => ({ ...f, pass: '' })); // clear pass field after save
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
    setTestBusy(true); setTestResult(null);
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
    <div className="space-y-6 max-w-xl">
      <form onSubmit={save} className="card-paper rounded-lg p-4 space-y-3">
        {err && <p className="text-sm text-seal">{err}</p>}
        {ok && <p className="text-sm text-green-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{ok}</p>}

        <div>
          <label className="text-sm font-medium">传输方式</label>
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="transport" value="console"
                checked={form.transport === 'console'}
                onChange={() => setForm(f => ({ ...f, transport: 'console' }))} />
              console(只打印)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="transport" value="smtp"
                checked={form.transport === 'smtp'}
                onChange={() => setForm(f => ({ ...f, transport: 'smtp' }))} />
              smtp(实际发送)
            </label>
          </div>
        </div>

        <Field label="SMTP 主机" placeholder="smtp.example.com"
          value={form.host} onChange={v => setForm(f => ({ ...f, host: v }))} />
        <div className="grid grid-cols-3 gap-2">
          <Field label="端口" placeholder="587"
            value={form.port} onChange={v => setForm(f => ({ ...f, port: v }))} />
          <label className="flex items-end gap-2 text-sm pb-2">
            <input type="checkbox" checked={form.secure}
              onChange={e => setForm(f => ({ ...f, secure: e.target.checked }))} />
            <span>SSL/TLS (465)</span>
          </label>
        </div>
        <Field label="用户名" value={form.user}
          onChange={v => setForm(f => ({ ...f, user: v }))} />
        <div>
          <label className="text-sm font-medium">
            密码 (SMTP 密码 / 授权码)
            <span className="ml-2 text-xs text-ink-soft">
              {form.pass ? '将覆盖现有值' : initial.passSet ? '已配置,留空不改' : '尚未配置'}
            </span>
          </label>
          <div className="mt-1 flex gap-1">
            <input
              type={showPass ? 'text' : 'password'}
              value={form.pass}
              onChange={e => setForm(f => ({ ...f, pass: e.target.value }))}
              placeholder={initial.passSet ? '(未修改)' : ''}
              className="flex-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
            />
            <button type="button" onClick={() => setShowPass(s => !s)}
              className="px-2 border border-paper-warm rounded text-ink-soft hover:bg-paper-deep"
              aria-label={showPass ? '隐藏密码' : '显示密码'}>
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <Field label="发件邮箱 (From)" placeholder="noreply@example.com"
          value={form.from} onChange={v => setForm(f => ({ ...f, from: v }))} />
        <Field label="发件人名称 (可选)" placeholder="字·韵"
          value={form.fromName} onChange={v => setForm(f => ({ ...f, fromName: v }))} />

        <button type="submit" disabled={busy}
          className="text-sm px-4 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50">
          {busy ? '保存中…' : '保存'}
        </button>
      </form>

      <div className="card-paper rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-ink">发送测试邮件</h2>
        <p className="text-xs text-ink-soft">使用上方保存的配置发送一封测试邮件到指定收件人,验证 SMTP 设置是否正确。</p>
        <div className="flex gap-2">
          <input
            type="email"
            value={testTo}
            onChange={e => setTestTo(e.target.value)}
            placeholder="your@email.com"
            className="flex-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          />
          <button type="button" onClick={sendTest} disabled={testBusy || !testTo}
            className="text-sm px-3 py-1.5 border border-ink/20 rounded hover:bg-paper-deep disabled:opacity-50">
            {testBusy ? '发送中…' : '发送'}
          </button>
        </div>
        {testResult && (
          <p className={`text-sm ${testResult.ok ? 'text-green-700' : 'text-seal'}`}>{testResult.message}</p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
    </div>
  );
}
