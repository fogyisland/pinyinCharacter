'use client';

import { useState } from 'react';
import { adminResetUserPassword } from '@/lib/api-admin';
import { ConfirmDialog } from './ConfirmDialog';

export function ResetPasswordDialog({ userId, username, open, onClose }: {
  userId: number; username: string; open: boolean; onClose: () => void;
}) {
  const [temp, setTemp] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (open && temp === null && !error) {
    adminResetUserPassword(userId).then(r => {
      if (r.ok) setTemp(r.data.tempPassword);
      else setError(r.error.message);
    });
  }

  function close() {
    setTemp(null); setCopied(false); setHandedOff(false); setError(null);
    onClose();
  }

  async function copy() {
    if (!temp) return;
    await navigator.clipboard.writeText(temp);
    setCopied(true);
  }

  return (
    <ConfirmDialog
      open={open}
      title={`重置 ${username} 的密码`}
      description="系统将生成一个临时密码。请把临时密码当面或通过安全渠道交给该用户,并建议其尽快修改。"
      confirmLabel={handedOff ? '关闭' : '已转交'}
      cancelLabel="取消"
      onClose={close}
      onConfirm={() => setHandedOff(true)}
    >
      {error && <p className="text-sm text-seal mb-2">{error}</p>}
      {temp && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <code className="flex-1 bg-paper-deep px-3 py-2 rounded text-sm font-mono break-all">{temp}</code>
            <button type="button" onClick={copy} className="text-sm px-2 py-1 border rounded hover:bg-paper-deep">
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <p className="text-xs text-ink-faint">关闭此对话框后,临时密码不再可见。</p>
        </>
      )}
    </ConfirmDialog>
  );
}
