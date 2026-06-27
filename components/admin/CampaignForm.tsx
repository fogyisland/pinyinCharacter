'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CampaignForm() {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [textBody, setTextBody] = useState('');
  const [audience, setAudience] = useState<'all' | 'members' | 'admins'>('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Naive HTML→text: strip tags + collapse whitespace. Good enough for a
  // 营销 email — admins can hand-edit the text body afterward if needed.
  function syncTextFromHtml(html: string) {
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    setTextBody(text);
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/email/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject, htmlBody, textBody, audience }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message ?? '保存失败');
      router.push(`/admin/email/campaigns/${data.data.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <label className="block text-sm font-medium text-ink-soft mb-1">主题</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={255}
          placeholder="例如:新版字帖描红功能上线"
          className="w-full border border-paper-warm rounded px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink-soft mb-1">受众</label>
        <select
          value={audience}
          onChange={(e) => setAudience(e.target.value as any)}
          className="border border-paper-warm rounded px-3 py-2 text-sm"
        >
          <option value="all">所有订阅用户</option>
          <option value="members">会员</option>
          <option value="admins">管理员</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-ink-soft mb-1">HTML 正文</label>
        <textarea
          value={htmlBody}
          onChange={(e) => { setHtmlBody(e.target.value); syncTextFromHtml(e.target.value); }}
          rows={10}
          placeholder="<p>新版描红模式上线,现在你可以...</p>"
          className="w-full border border-paper-warm rounded px-3 py-2 text-sm font-mono"
        />
        <p className="text-xs text-ink-faint mt-1">
          纯文本版本会自动从 HTML 提取 (去掉标签),如需手动调整可在下方修改。
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-ink-soft mb-1">纯文本版本</label>
        <textarea
          value={textBody}
          onChange={(e) => setTextBody(e.target.value)}
          rows={6}
          className="w-full border border-paper-warm rounded px-3 py-2 text-sm"
        />
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy || !subject.trim() || !htmlBody.trim()}
          className="px-4 py-2 rounded-md bg-ink text-paper text-sm hover:opacity-90 disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存为草稿'}
        </button>
      </div>
    </div>
  );
}