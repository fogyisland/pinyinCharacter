'use client';

import { useEffect } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <Header />
      <PageContainer>
        <div className="text-center py-16">
          <div className="font-kai text-[120px] text-ink/15 leading-none">误</div>
          <div className="stamp inline-block mt-4">500</div>
          <p className="text-ink-soft mt-6 mb-2">页面加载出错了</p>
          {error.digest && (
            <code className="text-xs text-ink-faint font-mono mb-4 block">[{error.digest}]</code>
          )}
          <button onClick={reset} className="btn-seal mt-2">刷新重试</button>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
