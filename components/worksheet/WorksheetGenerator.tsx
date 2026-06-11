'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CellStyle } from '@/lib/worksheet';
import { TextInputTab } from './TextInputTab';
import { LibrarySelectTab } from './LibrarySelectTab';
import { StylePicker } from './StylePicker';
import { WorksheetPreview } from './WorksheetPreview';

type Tab = 'text' | 'library';

export function WorksheetGenerator() {
  const sp = useSearchParams();
  const router = useRouter();
  const prefill = sp.get('prefill');

  const [tab, setTab] = useState<Tab>(prefill ? 'library' : 'text');
  const [content, setContent] = useState<string[]>(prefill ? [prefill] : []);
  const [title, setTitle] = useState('');
  const [cellStyle, setCellStyle] = useState<CellStyle>('brush');
  const [view, setView] = useState<'form' | 'preview'>('form');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (prefill) {
      setTab('library');
      setContent((cur) => (cur.includes(prefill) ? cur : [prefill, ...cur]));
    }
  }, [prefill]);

  const canPreview = content.length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || `字帖 ${new Date().toLocaleDateString()}`, content, cellStyle }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push(`/worksheet/${data.data.id}`);
      } else {
        alert('保存失败: ' + (data.error ?? '未知错误'));
      }
    } finally {
      setSaving(false);
    }
  };

  if (view === 'preview') {
    return (
      <WorksheetPreview
        title={title}
        content={content}
        cellStyle={cellStyle}
        onBack={() => setView('form')}
        onSave={handleSave}
        saving={saving}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab('text')}
          className={`px-4 py-2 ${tab === 'text' ? 'border-b-2 border-blue-600 font-medium' : 'text-gray-500'}`}
        >
          自由输入
        </button>
        <button
          type="button"
          onClick={() => setTab('library')}
          className={`px-4 py-2 ${tab === 'library' ? 'border-b-2 border-blue-600 font-medium' : 'text-gray-500'}`}
        >
          从字库选
        </button>
      </div>

      {tab === 'text' ? (
        <TextInputTab value={content} onChange={setContent} />
      ) : (
        <LibrarySelectTab selected={content} onChange={setContent} />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">标题(可选)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder="给字帖起个名字..."
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">格子样式</label>
          <div className="mt-2">
            <StylePicker value={cellStyle} onChange={setCellStyle} />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setView('preview')}
          disabled={!canPreview}
          className="rounded-md bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          生成字帖
        </button>
      </div>
    </div>
  );
}
