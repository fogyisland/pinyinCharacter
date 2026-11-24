'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

function SuccessInner() {
  const sp = useSearchParams();
  const orderId = sp.get('orderId');
  const [status, setStatus] = useState<'pending' | 'paid' | 'failed' | 'timeout'>('pending');
  const [planName, setPlanName] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const poll = useCallback(async () => {
    if (!orderId) {
      setStatus('failed');
      return;
    }
    try {
      const res = await fetch(`/api/membership/orders/${orderId}`, {
        credentials: 'same-origin',
      });
      const j = await res.json();
      if (!j.ok) return;
      if (j.data.status === 'paid') {
        setStatus('paid');
        setPlanName(j.data.planDisplayName);
      } else if (j.data.status === 'failed' || j.data.status === 'expired') {
        setStatus('failed');
      }
      setRefreshFailed(false);
    } catch (error) {
      console.debug('订单状态刷新失败，将在下一次轮询重试', error);
      setRefreshFailed(true);
    }
  }, [orderId]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 2000);
    const stop = setTimeout(() => {
      clearInterval(t);
      setStatus((current) => (current === 'pending' ? 'timeout' : current));
    }, 30000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [poll]);

  return (
    <main className="max-w-md mx-auto p-8 text-center space-y-4">
      {status === 'pending' && (
        <>
          <Loader2 className="h-12 w-12 mx-auto text-seal animate-spin" />
          <h1 className="font-kai text-xl">等待支付确认…</h1>
          <p className="text-sm text-ink-soft">请在 PayPal 页面完成支付。本页面会自动刷新状态。</p>
          {refreshFailed && <p className="text-xs text-seal">状态刷新失败，正在重试…</p>}
        </>
      )}
      {status === 'timeout' && (
        <>
          <AlertTriangle className="h-12 w-12 mx-auto text-warning" />
          <h1 className="font-kai text-xl">确认超时</h1>
          <p className="text-sm text-ink-soft">
            30 秒内未收到支付确认。请到 PayPal 核对订单状态；若已扣款，
            通常几分钟内会自动开通，也可稍后到个人中心查看。
          </p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-sm px-4 py-2 bg-seal text-paper rounded hover:bg-seal/80"
            >
              重新查询
            </button>
            <Link
              href="/profile"
              className="text-sm px-4 py-2 border border-ink/20 rounded text-ink hover:bg-paper-deep"
            >
              查看我的会员
            </Link>
          </div>
        </>
      )}
      {status === 'paid' && (
        <>
          <Check className="h-12 w-12 mx-auto text-success" />
          <h1 className="font-kai text-xl">开通成功!</h1>
          {planName && <p className="text-sm text-ink-soft">{planName} 已激活。</p>}
          <Link
            href="/profile"
            className="inline-block text-sm px-4 py-2 bg-ink text-paper rounded hover:bg-ink/80"
          >
            查看我的会员
          </Link>
        </>
      )}
      {status === 'failed' && (
        <>
          <AlertTriangle className="h-12 w-12 mx-auto text-seal" />
          <h1 className="font-kai text-xl">支付未完成</h1>
          <p className="text-sm text-ink-soft">订单可能已过期或被取消。如已扣款请联系客服。</p>
          <Link
            href="/membership"
            className="inline-block text-sm px-4 py-2 border border-ink/20 rounded text-ink hover:bg-paper-deep"
          >
            重试
          </Link>
        </>
      )}
    </main>
  );
}

export default function MembershipSuccessPage() {
  return (
    <>
      <Header />
      <Suspense fallback={<p className="p-8 text-center text-ink-faint">加载中…</p>}>
        <SuccessInner />
      </Suspense>
      <Footer />
    </>
  );
}
