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
    <p className="text-sm text-gray-700">
      链接已失效,请返回 <a href="/forgot-password" className="text-blue-600 hover:underline">忘记密码</a> 重新申请。
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
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <h1 className="text-lg font-semibold">字 ↔ 拼音 工具</h1>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white border rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">重置密码</h2>
          {children}
        </div>
      </main>
    </div>
  );
}
