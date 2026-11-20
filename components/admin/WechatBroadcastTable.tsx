'use client';

import { useCallback, useState } from 'react';
import type { WechatBroadcast } from '@/lib/wechat-types';

interface Props {
  initialBroadcasts: WechatBroadcast[];
}

/**
 * The announcement history.
 *
 * ⚠️ The counts are "accepted", not "delivered" — WeChat issues no delivery
 * receipt for a template message, so a zero errcode means the request was
 * accepted and nothing more. The column says so.
 */
export function WechatBroadcastTable({ initialBroadcasts }: Props) {
  const [broadcasts, setBroadcasts] = useState<WechatBroadcast[]>(initialBroadcasts);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/wechat/broadcasts');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? '读取公告记录失败');
      setBroadcasts(body.data.broadcasts ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const act = useCallback(
    async (id: number, action: 'send' | 'cancel') => {
      setBusyId(id);
      setError(null);
      try {
        const response = await fetch(
          `/api/admin/wechat/broadcasts/${id}/${action}`,
          { method: 'POST' },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? '操作失败');
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-ink/20 px-2 py-1 text-sm text-ink-soft"
        >
          刷新
        </button>
      </div>

      <p className="text-xs text-ink-soft">
        「平台接受」指微信平台接收了这条消息，不代表对方一定收到 —— 微信不提供送达回执。
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      {broadcasts.length === 0 ? (
        <p className="text-sm text-ink-soft">还没有发过公告。</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-ink-soft">
            <tr>
              <th className="py-1">标题</th>
              <th className="py-1">状态</th>
              <th className="py-1">人数</th>
              <th className="py-1">平台接受</th>
              <th className="py-1">跳过</th>
              <th className="py-1">失败</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {broadcasts.map((broadcast) => (
              <tr key={broadcast.id} className="border-t border-rule">
                <td className="py-1 text-ink">
                  {broadcast.title}
                  {broadcast.lastError && (
                    <p className="text-xs text-danger">{broadcast.lastError}</p>
                  )}
                </td>
                <td className="py-1 text-ink-soft">{broadcast.status}</td>
                <td className="py-1 font-mono">{broadcast.totalRecipients}</td>
                <td className="py-1 font-mono">{broadcast.acceptedCount}</td>
                <td className="py-1 font-mono">{broadcast.skippedCount}</td>
                <td className="py-1 font-mono">{broadcast.failedCount}</td>
                <td className="py-1 text-right">
                  {broadcast.status === 'queued' && (
                    <button
                      type="button"
                      disabled={busyId === broadcast.id}
                      onClick={() => void act(broadcast.id, 'send')}
                      className="rounded border border-rule px-2 py-0.5 text-xs"
                    >
                      立即发送
                    </button>
                  )}
                  {(broadcast.status === 'draft' || broadcast.status === 'queued') && (
                    <button
                      type="button"
                      disabled={busyId === broadcast.id}
                      onClick={() => void act(broadcast.id, 'cancel')}
                      className="rounded border border-rule px-2 py-0.5 text-xs ml-1"
                    >
                      取消
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
