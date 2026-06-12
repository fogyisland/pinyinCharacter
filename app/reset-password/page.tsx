import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { findValidResetRow } from '@/lib/password-reset';
import { getPool } from '@/lib/db';
import { ResetForm } from './ResetForm';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  const token = sp.token ?? '';
  const expired = (
    <p className="text-sm text-ink-soft">
      链接已失效,请返回 <a href="/forgot-password" className="text-seal hover:underline">忘记密码</a> 重新申请。
    </p>
  );

  if (token.length < 32) {
    return <Shell>{expired}</Shell>;
  }

  const row = await findValidResetRow(token);
  if (!row) {
    return <Shell>{expired}</Shell>;
  }

  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT username FROM users WHERE id = ? LIMIT 1`,
    [row.user_id]
  );
  if (rows.length === 0) return <Shell>{expired}</Shell>;
  const username = rows[0].username as string;

  return <Shell><ResetForm token={token} username={username} /></Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="max-w-sm mx-auto card-paper p-6 mt-8">
          <div className="font-kai text-center text-ink-faint tracking-[0.3em] text-xs mb-4">字 · 韵</div>
          <h1 className="font-kai text-2xl text-center text-ink mb-2">重置密码</h1>
          <div className="paper-rule w-12 mx-auto mb-6" />
          {children}
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
