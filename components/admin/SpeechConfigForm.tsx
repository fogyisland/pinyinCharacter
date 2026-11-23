'use client';

import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import {
  updateSpeechConfigRequest,
  verifySpeechConfigRequest,
  type SpeechConfigPayload,
  type SpeechVerifyPayload,
} from '@/lib/api-admin';
import { Panel } from '@/components/admin/Panel';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';

/**
 * The /admin/speech configuration form — Azure 语音评测.
 *
 * Two fields, and one rule that shapes the whole form: **the key is never
 * shown**. It cannot be, because the GET reports only `hasKey` — a page that
 * can display a secret is a page that leaks it through a screenshot. So the
 * key input starts empty and its hint says what that means:
 *
 *   已配置 · 留空不改   the stored key stays
 *   尚未配置           nothing works until a key is pasted
 *
 * And the server treats an empty value as "unchanged" for exactly this
 * reason: a form that shows a blank secret must not send a blank secret.
 */
export function SpeechConfigForm({
  initialConfig,
  initialHasKey,
}: {
  initialConfig: Record<string, string>;
  initialHasKey: boolean;
}) {
  const [region, setRegion] = useState(initialConfig['speech.region'] ?? '');
  const [dailyLimit, setDailyLimit] = useState(initialConfig['speech.daily_limit'] ?? '');
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(initialHasKey);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [verdict, setVerdict] = useState<SpeechVerifyPayload | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    // Both fields are sent every time. The key is skipped when blank, which
    // the server reads as "unchanged" — the alternative (tracking "did the
    // admin touch this") is a second piece of state that can disagree with
    // what is on screen.
    const body: Record<string, string> = { 'speech.region': region.trim() };
    if (dailyLimit.trim() !== '') body['speech.daily_limit'] = dailyLimit.trim();
    if (key.trim() !== '') body['speech.key'] = key.trim();
    try {
      const result = await updateSpeechConfigRequest(body);
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      const payload: SpeechConfigPayload = result.data;
      setRegion(payload.config['speech.region'] ?? '');
      setDailyLimit(payload.config['speech.daily_limit'] ?? '');
      // Cleared on success: the new key is now stored, and leaving it in the
      // field would keep a secret sitting on screen.
      setKey('');
      setHasKey(payload.hasKey);
      setMsg('配置已保存');
    } catch (e) {
      setErr((e as Error).message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    // The old verdict belongs to the old saved pair: keeping it visible
    // while a new test runs would let the operator read a stale answer.
    setVerdict(null);
    setErr(null);
    try {
      const result = await verifySpeechConfigRequest();
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      setVerdict(result.data);
    } catch (e) {
      setErr((e as Error).message || '测试失败');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Panel className="max-w-xl">
      <form onSubmit={save} className="space-y-3">
        {err && (
          <p className="text-sm text-danger inline-flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {err}
          </p>
        )}
        {msg && (
          <p className="text-sm text-success inline-flex items-center gap-1">
            <Check className="h-3.5 w-3.5" />
            {msg}
          </p>
        )}

        <div className="space-y-1">
          <h2 className="font-kai text-base text-ink">Azure 语音评测</h2>
          <p className="text-xs text-ink-soft">
            配置后，字典页的跟读面板会多出「精评」按钮：录音交给 Azure 做音素级打分。
            未配置时只有浏览器自带识别，录音不出浏览器。
          </p>
        </div>

        <FormField
          label="区域 (Region)"
          htmlFor="speech-region"
          hint="Azure 语音资源的区域，例如 eastasia / westus / southeastasia。只填区域名，不带域名。"
        >
          <input
            id="speech-region"
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="eastasia"
            className="adm-input"
          />
        </FormField>

        <FormField
          label="密钥 (Key)"
          htmlFor="speech-key"
          hint={
            hasKey
              ? '已配置，留空不改。要更换就直接粘贴新的。'
              : '尚未配置。粘贴 Azure 门户里「密钥和终结点」页的密钥。'
          }
        >
          <input
            id="speech-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? '••••••••（留空不改）' : ''}
            className="adm-input"
          />
        </FormField>

        <FormField
          label="每人每天上限 (0 = 不限)"
          htmlFor="speech-daily-limit"
          hint="Azure 按音频秒数计费，这个上限挡住重试循环把账单推高。留空表示沿用已存的值。"
        >
          <input
            id="speech-daily-limit"
            type="number"
            min={0}
            max={9999}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            placeholder="20"
            className="adm-input"
          />
        </FormField>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <AdminButton type="submit" variant="primary" disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </AdminButton>
          <AdminButton
            type="button"
            variant="secondary"
            disabled={busy || testing || !hasKey}
            onClick={() => void testConnection()}
            title={hasKey ? undefined : '先保存 region 和 key'}
          >
            {testing ? '测试中…' : '测试连接'}
          </AdminButton>
          {hasKey ? null : (
            <span className="text-xs text-ink-faint">保存后才能测试</span>
          )}
        </div>

        {/* The verdict occupies its own line and keeps a fixed place: an
            operator who just clicked 测试连接 should not have to hunt for the
            answer among the save messages. */}
        {verdict ? (
          <p
            role="status"
            className={
              'text-sm rounded border px-3 py-2 ' +
              (verdict.ok
                ? 'text-success border-success/30 bg-success/8'
                : 'text-danger border-danger/30 bg-danger/8')
            }
          >
            {verdict.ok ? '凭据可用：Azure 已接受这组 region 和 key。' : verdict.message}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}
