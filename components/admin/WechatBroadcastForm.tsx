'use client';

import { useCallback, useState } from 'react';

interface TemplateField {
  key: string;
  value: string;
}

/**
 * The announcement composer.
 *
 * ⚠️ Creating an announcement does not send it — it queues it. The
 * scheduler sends one queued announcement per tick, and an announcement that
 * went out the moment it was written would have no chance to be cancelled.
 */
export function WechatBroadcastForm() {
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [url, setUrl] = useState('');
  const [fields, setFields] = useState<TemplateField[]>([
    { key: 'first', value: '' },
    { key: 'keyword1', value: '' },
  ]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updateField = useCallback((index: number, patch: Partial<TemplateField>) => {
    setFields((current) =>
      current.map((field, position) =>
        position === index ? { ...field, ...patch } : field,
      ),
    );
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    const data: Record<string, { value: string }> = {};
    for (const field of fields) {
      if (field.key.trim() === '') continue;
      data[field.key.trim()] = { value: field.value };
    }
    try {
      const response = await fetch('/api/admin/wechat/broadcasts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, templateId, url, data }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? '提交失败');
      setMessage(`已入队：${body.data.id}，下一次 scheduler tick 会发出。`);
      setTitle('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [title, templateId, url, fields]);

  return (
    <div className="space-y-3">
      <label className="block text-sm text-ink">
        标题
        <input
          className="mt-1 w-full rounded border border-rule px-2 py-1"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="v1.2 已上线"
        />
      </label>

      <label className="block text-sm text-ink">
        模板 ID
        <input
          className="mt-1 w-full rounded border border-rule px-2 py-1 font-mono"
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
          placeholder="TM00001"
        />
      </label>

      <label className="block text-sm text-ink">
        跳转链接（可留空）
        <input
          className="mt-1 w-full rounded border border-rule px-2 py-1 font-mono"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://..."
        />
      </label>

      <div className="space-y-2">
        <p className="text-sm text-ink">模板字段</p>
        <p className="text-xs text-ink-soft">
          字段名必须与公众号后台模板里的字段名完全一致（keyword1 / thing2 / first / remark）。
        </p>
        {fields.map((field, index) => (
          <div key={index} className="flex gap-2">
            <input
              className="w-40 rounded border border-rule px-2 py-1 font-mono text-sm"
              value={field.key}
              onChange={(event) => updateField(index, { key: event.target.value })}
              placeholder="keyword1"
            />
            <input
              className="flex-1 rounded border border-rule px-2 py-1 text-sm"
              value={field.value}
              onChange={(event) => updateField(index, { value: event.target.value })}
              placeholder="值"
            />
            <button
              type="button"
              onClick={() => setFields((current) => current.filter((_, p) => p !== index))}
              className="rounded border border-rule px-2 text-sm text-ink-soft"
            >
              删
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setFields((current) => [...current, { key: '', value: '' }])}
          className="rounded border border-rule px-2 py-1 text-sm text-ink-soft"
        >
          加一个字段
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded bg-seal px-3 py-1 text-sm text-paper disabled:opacity-50"
        >
          {busy ? '提交中…' : '发送公告'}
        </button>
        {message && <span className="text-sm text-ink-soft">{message}</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}
