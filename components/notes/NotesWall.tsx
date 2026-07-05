'use client';
import { useState } from 'react';
import { NotesForm } from './NotesForm';

export interface ClientNote {
  id: number;
  authorName: string;
  authorEmail: string | null;
  content: string;
  createdAt: string; // ISO
}

interface NotesWallProps { initial: ClientNote[]; defaultName?: string; }

export function NotesWall({ initial, defaultName }: NotesWallProps) {
  const [notes, setNotes] = useState<ClientNote[]>(initial);

  function handlePosted(id: number) {
    // Optimistic insert; form cleared by parent.
    setNotes((cur) => [{
      id,
      authorName: defaultName ?? '我',
      authorEmail: null,
      content: (document.getElementById('notes-content') as HTMLTextAreaElement | null)?.value ?? '',
      createdAt: new Date().toISOString(),
    }, ...cur]);
  }

  return (
    <div className="space-y-6">
      <NotesForm onPosted={handlePosted} defaultName={defaultName} />
      <section aria-label="留言列表">
        {notes.length === 0
          ? <p className="text-gray-500 italic">暂无留言,做第一个发声的人。</p>
          : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="p-4 border rounded-lg bg-paper">
                  <div className="flex items-baseline gap-2 text-sm text-gray-600">
                    <span className="font-medium text-ink">{n.authorName}</span>
                    <time dateTime={n.createdAt}>{fmtTime(n.createdAt)}</time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-ink">{n.content}</p>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
