'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, Trash2 } from 'lucide-react';
import {
  WECOM_CATEGORIES,
  WECOM_CATEGORY_LABELS,
  WECOM_DEFAULT_CATEGORIES,
  type WecomCategory,
  type WecomWebhook,
} from '@/lib/wecom-types';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';

/** One group as the form edits it — a row that may not be saved yet. */
interface Draft {
  /** `null` for a group that has not been created yet. */
  id: number | null;
  name: string;
  webhookUrl: string;
  enabled: boolean;
  categories: WecomCategory[];
}

function toDraft(webhook: WecomWebhook): Draft {
  return {
    id: webhook.id,
    name: webhook.name,
    webhookUrl: webhook.webhookUrl,
    enabled: webhook.enabled,
    categories: [...webhook.categories],
  };
}

/** A brand new group: not enabled, and only the safe categories. */
function emptyDraft(): Draft {
  return {
    id: null,
    name: '',
    webhookUrl: '',
    enabled: false,
    categories: [...WECOM_DEFAULT_CATEGORIES],
  };
}

export function WecomWebhookForm({ initial }: { initial: WecomWebhook[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(initial.map(toDraft));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function patch(id: number | null, change: Partial<Draft>) {
    setDrafts((previous) =>
      previous.map((draft) =>
        draft.id === id ? { ...draft, ...change } : draft,
      ),
    );
  }

  function toggleCategory(id: number | null, category: WecomCategory, checked: boolean) {
    setDrafts((previous) =>
      previous.map((draft) => {
        if (draft.id !== id) return draft;
        const next = checked
          ? [...draft.categories, category]
          : draft.categories.filter((c) => c !== category);
        // A category may appear only once — the order follows the catalogue.
        return {
          ...draft,
          categories: WECOM_CATEGORIES.filter((c) => next.includes(c)),
        };
      }),
    );
  }

  async function call(
    key: string,
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
  ): Promise<void> {
    setBusyId(key);
    setMsg(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '请求失败');
      setMsg({ kind: 'ok', text: '已保存' });
      router.refresh();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  async function save(draft: Draft) {
    if (draft.id === null) {
      await call('new', '/api/admin/wecom/webhooks', 'POST', {
        name: draft.name,
        webhookUrl: draft.webhookUrl,
        enabled: draft.enabled,
        categories: draft.categories,
      });
      return;
    }
    await call(String(draft.id), '/api/admin/wecom/webhooks', 'PUT', {
      id: draft.id,
      name: draft.name,
      webhookUrl: draft.webhookUrl,
      enabled: draft.enabled,
      categories: draft.categories,
    });
  }

  async function remove(draft: Draft) {
    if (draft.id === null) return;
    if (!confirm(`删除群「${draft.name || '?'}」? 该群的转发记录也会一并删除。`)) return;
    await call(String(draft.id), `/api/admin/wecom/webhooks?id=${draft.id}`, 'DELETE');
  }

  async function test(draft: Draft) {
    if (draft.id === null) {
      setMsg({ kind: 'err', text: '请先保存这个群，再测试。' });
      return;
    }
    setBusyId(String(draft.id));
    setMsg(null);
    try {
      const res = await fetch('/api/admin/wecom/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ webhookId: draft.id }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '发送失败');
      setMsg({ kind: 'ok', text: '测试消息已发出 — 去群里看看。' });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  const newDraft = drafts.find((draft) => draft.id === null);

  return (
    <div className="space-y-4">
      {msg && (
        <p
          className={`text-sm rounded border px-3 py-2 ${
            msg.kind === 'ok'
              ? 'text-success border-success/30 bg-success/8'
              : 'text-danger border-danger/30 bg-danger/8'
          }`}
        >
          {msg.kind === 'ok' && <Check className="h-3.5 w-3.5 inline" aria-hidden />}
          {msg.text}
        </p>
      )}

      {drafts.filter((draft) => draft.id !== null).map((draft) => (
        <div key={draft.id} className="border border-ink/15 rounded p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-kai text-base text-ink">{draft.name || '(未命名)'}</h3>
            <div className="flex items-center gap-2">
              <AdminButton
                size="sm"
                variant="secondary"
                disabled={busyId !== null}
                onClick={() => void test(draft)}
              >
                {busyId === String(draft.id) ? '发送中…' : '测试'}
              </AdminButton>
              <AdminButton
                size="sm"
                variant="primary"
                disabled={busyId !== null}
                onClick={() => void save(draft)}
              >
                保存
              </AdminButton>
              <AdminButton
                size="sm"
                variant="danger"
                disabled={busyId !== null}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => void remove(draft)}
              >
                删除
              </AdminButton>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="群名称" htmlFor={`wecom-name-${draft.id}`}>
              <input
                id={`wecom-name-${draft.id}`}
                type="text"
                value={draft.name}
                maxLength={64}
                onChange={(e) => patch(draft.id, { name: e.target.value })}
                className="adm-input"
              />
            </FormField>
            <FormField
              label="群机器人 Webhook 地址"
              htmlFor={`wecom-url-${draft.id}`}
              hint="在企业微信群里「添加群机器人」得到的地址，形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"
            >
              <input
                id={`wecom-url-${draft.id}`}
                type="text"
                value={draft.webhookUrl}
                maxLength={512}
                onChange={(e) => patch(draft.id, { webhookUrl: e.target.value })}
                className="adm-input font-mono text-xs"
              />
            </FormField>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={busyId !== null}
              onChange={(e) => patch(draft.id, { enabled: e.target.checked })}
              className="h-4 w-4"
            />
            启用这个群（关着就只保存配置，不推送）
          </label>

          <div>
            <div className="text-xs text-ink-soft mb-1">接收的通知类别</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {WECOM_CATEGORIES.map((category) => (
                <label
                  key={category}
                  className="flex items-center gap-1.5 text-sm text-ink cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={draft.categories.includes(category)}
                    disabled={busyId !== null}
                    onChange={(e) => toggleCategory(draft.id, category, e.target.checked)}
                    className="h-4 w-4"
                  />
                  {WECOM_CATEGORY_LABELS[category]}
                </label>
              ))}
            </div>
            <p className="text-xs text-ink-faint mt-1.5">
              「密码重置」会把重置链接发给群里所有人，默认不勾。
            </p>
          </div>
        </div>
      ))}

      {newDraft ? (
        <div className="border border-dashed border-ink/25 rounded p-3 space-y-3">
          <h3 className="font-kai text-base text-ink">新增群</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="群名称" htmlFor="wecom-new-name">
              <input
                id="wecom-new-name"
                type="text"
                value={newDraft.name}
                maxLength={64}
                onChange={(e) => patch(null, { name: e.target.value })}
                className="adm-input"
              />
            </FormField>
            <FormField label="群机器人 Webhook 地址" htmlFor="wecom-new-url">
              <input
                id="wecom-new-url"
                type="text"
                value={newDraft.webhookUrl}
                maxLength={512}
                onChange={(e) => patch(null, { webhookUrl: e.target.value })}
                className="adm-input font-mono text-xs"
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={newDraft.enabled}
              disabled={busyId !== null}
              onChange={(e) => patch(null, { enabled: e.target.checked })}
              className="h-4 w-4"
            />
            启用这个群
          </label>
          <div>
            <div className="text-xs text-ink-soft mb-1">接收的通知类别</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {WECOM_CATEGORIES.map((category) => (
                <label
                  key={category}
                  className="flex items-center gap-1.5 text-sm text-ink cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={newDraft.categories.includes(category)}
                    disabled={busyId !== null}
                    onChange={(e) => toggleCategory(null, category, e.target.checked)}
                    className="h-4 w-4"
                  />
                  {WECOM_CATEGORY_LABELS[category]}
                </label>
              ))}
            </div>
          </div>
          <AdminButton
            variant="primary"
            disabled={busyId !== null}
            onClick={() => void save(newDraft)}
          >
            {busyId === 'new' ? '保存中…' : '保存'}
          </AdminButton>
        </div>
      ) : (
        <AdminButton
          variant="secondary"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setDrafts((previous) => [...previous, emptyDraft()])}
        >
          新增群
        </AdminButton>
      )}
    </div>
  );
}
