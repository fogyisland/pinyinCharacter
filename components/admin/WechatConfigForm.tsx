'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WechatConfig } from '@/lib/wechat-config';

interface Props {
  initialConfig: WechatConfig;
}

/**
 * The WeChat credentials and the follower count.
 *
 * ⚠️ The app secret is a write-only field. The server never sends it back,
 * so an empty input means "keep the one that is already there" — which is
 * why this component keeps the secret in local state and clears it after a
 * successful save.
 */
export function WechatConfigForm({ initialConfig }: Props) {
  const [config, setConfig] = useState<WechatConfig>(initialConfig);
  const [appSecret, setAppSecret] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [followerError, setFollowerError] = useState<string | null>(null);

  // The follower count needs a live call to WeChat, so it is fetched after
  // mount rather than read on the server — a server component must not
  // block the whole page on a third-party API.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/admin/wechat/followers');
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setFollowerError(body.error?.message ?? '读取关注者数量失败');
          return;
        }
        setFollowerCount(body.data.count);
      } catch (caught) {
        if (!cancelled) {
          setFollowerError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/admin/wechat/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: config.enabled,
          appId: config.appId,
          appSecret,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? '保存失败');
      setConfig(body.data.config);
      setAppSecret('');
      setMessage('已保存');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [config, appSecret]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
        />
        启用微信公告
      </label>

      <label className="block text-sm text-ink">
        AppID
        <input
          className="mt-1 w-full rounded border border-rule px-2 py-1 font-mono"
          value={config.appId}
          onChange={(event) => setConfig({ ...config, appId: event.target.value })}
          placeholder="wx..."
        />
      </label>

      <label className="block text-sm text-ink">
        AppSecret
        <input
          type="password"
          className="mt-1 w-full rounded border border-rule px-2 py-1 font-mono"
          value={appSecret}
          onChange={(event) => setAppSecret(event.target.value)}
          placeholder={config.appSecretSet ? '已配置，留空则不修改' : '尚未配置'}
        />
      </label>

      <div className="rounded border border-danger/40 bg-danger/5 p-3 text-xs text-ink-soft space-y-1">
        <p>请在公众号后台完成两项配置，否则调用会失败：</p>
        <p>1. 把服务器的公网 IP 加入「IP 白名单」，否则接口会返回 40164。</p>
        <p>2. 每日接口调用有额度，发送人数 × 公告次数不要超出。</p>
      </div>

      <div className="text-sm">
        关注者人数：
        {followerCount === null ? (
          <span className="text-ink-soft">读取中…</span>
        ) : (
          <span className={followerCount === 0 ? 'text-danger font-semibold' : 'text-ink'}>
            {followerCount} 人
          </span>
        )}
        {followerError && <p className="text-danger text-xs mt-1">{followerError}</p>}
        {followerCount === 0 && (
          <p className="text-danger text-xs mt-1">
            还没有关注者，公告发不出去。请把公众号的二维码放到站点上。
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded bg-seal px-3 py-1 text-sm text-paper disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存'}
        </button>
        {message && <span className="text-sm text-ink-soft">{message}</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}
