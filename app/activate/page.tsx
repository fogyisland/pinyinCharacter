'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Unlock, Loader2, ExternalLink } from 'lucide-react';

interface Status {
  ready: boolean;
  shortName?: string;
  isActivated?: boolean;
  isExpired?: boolean;
  expireDate?: string | null;
  isLocked?: boolean;
  lastCloudSyncAt?: string | null;
  cloudEndpoint?: string | null;
}

/**
 * Shown when middleware redirects on activation lock. Displays the install
 * short name + locked state, contact info, and a form to submit an
 * activation code. Polls /api/activation/status every 5s so the page
 * auto-redirects home once the cloud or admin unlocks the install.
 */
export default function ActivatePage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch('/api/activation/status', { cache: 'no-store' });
        const d = await r.json();
        if (cancelled) return;
        setStatus(d.data);
        // If the cloud cleared the lock while we were on this page, bounce home.
        if (d.data?.ready && d.data.isLocked === false) {
          router.replace('/');
        }
      } catch { /* ignore */ }
    }
    tick();
    const t = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [router]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/activation/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const d = await r.json();
      if (!d.ok) {
        setErr(d.error?.message ?? '激活失败');
        return;
      }
      setOk(true);
      // Give the audit log a beat, then bounce home.
      setTimeout(() => router.replace('/'), 800);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg py-12">
      <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-6 text-center">
        <Lock className="mx-auto h-12 w-12 text-amber-700" />
        <h1 className="mt-3 text-2xl font-semibold text-ink">平台实例已锁定</h1>
        <p className="mt-2 text-sm text-ink-soft">
          此部署已被云端暂停访问。如需恢复,请联系平台运营方获取激活码。
        </p>

        {status?.ready && (
          <div className="mt-4 rounded-md border border-ink/15 bg-paper-soft p-3 text-left text-xs text-ink-soft">
            <div><span className="text-ink-faint">实例标识:</span> <code className="font-mono">{status.shortName}</code></div>
            {status.expireDate && (
              <div className="mt-1"><span className="text-ink-faint">到期时间:</span> {new Date(status.expireDate).toLocaleString('zh-CN')}</div>
            )}
            {status.lastCloudSyncAt && (
              <div className="mt-1"><span className="text-ink-faint">最近云端同步:</span> {new Date(status.lastCloudSyncAt).toLocaleString('zh-CN')}</div>
            )}
          </div>
        )}

        {status?.cloudEndpoint && (
          <a
            href={status.cloudEndpoint}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-sm text-seal hover:underline"
          >
            联系平台运营 <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <form onSubmit={handleUnlock} className="mt-6 space-y-3 rounded-md border border-ink/20 bg-paper-soft p-6">
        <h2 className="text-base font-medium text-ink">输入激活码解锁</h2>
        <p className="text-xs text-ink-faint">
          激活码由平台运营方提供。提交后将立即清除本实例的锁定标记。
        </p>
        <input
          type="text" required minLength={4} maxLength={128} value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="BOOM-XXXX-XXXX-XXXX"
          className="w-full rounded-md border border-ink/20 px-3 py-2 font-mono"
        />
        {err && <div className="rounded-md border border-seal/30 bg-seal/5 p-2 text-sm text-seal">{err}</div>}
        {ok && (
          <div className="rounded-md border border-green-300 bg-green-50 p-2 text-sm text-green-700">
            <Unlock className="mr-1 inline h-4 w-4" /> 解锁成功,正在跳转…
          </div>
        )}
        <button
          type="submit" disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-seal px-4 py-2 text-white hover:bg-seal/80 disabled:opacity-50"
        >
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> 验证中…</> : '解锁'}
        </button>
      </form>
    </div>
  );
}
