'use client';
import { useState } from 'react';

interface NotesFormProps {
  onPosted: (id: number) => void;
  defaultName?: string;
}

export function NotesForm({ onPosted, defaultName }: NotesFormProps) {
  const [name, setName] = useState(defaultName ?? '');
  const [email, setEmail] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: email || undefined, content }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error?.message ?? '提交失败,请稍后再试');
        return;
      }
      onPosted(body.data.id);
      setContent('');
    } catch {
      setError('网络错误,请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 border rounded-lg bg-paper-warm">
      <div>
        <label htmlFor="notes-name" className="block text-sm font-medium">姓名 <span className="text-red-600">*</span></label>
        <input id="notes-name" type="text" maxLength={64} required value={name}
               onChange={(e) => setName(e.target.value)}
               disabled={submitting}
               className="mt-1 block w-full border rounded px-2 py-1" />
      </div>
      <div>
        <label htmlFor="notes-email" className="block text-sm font-medium">邮箱 <span className="text-gray-500">(选填,不会公开)</span></label>
        <input id="notes-email" type="email" maxLength={254} value={email}
               onChange={(e) => setEmail(e.target.value)}
               disabled={submitting}
               className="mt-1 block w-full border rounded px-2 py-1" />
      </div>
      <div>
        <label htmlFor="notes-content" className="block text-sm font-medium">留言内容 <span className="text-red-600">*</span></label>
        <textarea id="notes-content" required rows={4} maxLength={1000} value={content}
                  onChange={(e) => setContent(e.target.value)}
                  disabled={submitting}
                  className="mt-1 block w-full border rounded px-2 py-1" />
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <button type="submit" disabled={submitting || !!error || name.trim() === '' || content.trim() === ''}
              className="px-4 py-2 bg-ink text-paper rounded disabled:opacity-50">
        {submitting ? '发布中…' : '发布'}
      </button>
    </form>
  );
}