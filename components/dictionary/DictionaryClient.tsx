'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Char } from '@/lib/chars-types';
import { PinyinAnchor } from './PinyinAnchor';
import { RadicalSidebar, RADICALS } from './RadicalSidebar';
import { DictionaryCharGrid } from './DictionaryCharGrid';

interface Props {
  chars: Char[];
  total: number;
  page: number;
  pageSize: number;
}

export function DictionaryClient({ chars, total, page, pageSize }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const view = sp.get('view') === 'radical' ? 'radical' : 'pinyin';
  const activeLetter = sp.get('letter') ?? undefined;
  const activeRadical = sp.get('radical') ?? undefined;

  const switchView = (newView: 'pinyin' | 'radical') => {
    const params = new URLSearchParams(sp.toString());
    params.set('view', newView);
    if (newView === 'pinyin') {
      params.delete('radical');
    } else {
      params.delete('letter');
    }
    router.push(`/dictionary?${params.toString()}`);
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-ink-faint tracking-widest">字典 · {total} 字</span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => switchView('pinyin')}
            className={`text-sm px-3 py-1 rounded ${
              view === 'pinyin' ? 'bg-ink text-paper' : 'bg-paper-warm text-ink-soft border border-ink/20'
            }`}
          >
            按拼音
          </button>
          <button
            onClick={() => switchView('radical')}
            className={`text-sm px-3 py-1 rounded ${
              view === 'radical' ? 'bg-ink text-paper' : 'bg-paper-warm text-ink-soft border border-ink/20'
            }`}
          >
            按部首
          </button>
        </div>
      </div>

      {view === 'pinyin' ? (
        <>
          <PinyinAnchor activeLetter={activeLetter} />
          <DictionaryCharGrid chars={chars} />
        </>
      ) : (
        <div className="flex gap-4">
          <RadicalSidebar activeRadical={activeRadical} />
          <div className="flex-1">
            <div className="text-xs text-ink-faint mb-3">
              {activeRadical ? `部首「${activeRadical}」` : '选择一个部首'}
            </div>
            <DictionaryCharGrid chars={chars} />
          </div>
        </div>
      )}

      {/* Pagination: simple next/prev */}
      <div className="mt-6 flex justify-center gap-3 text-sm text-ink-soft">
        {page > 1 && (
          <a
            href={`/dictionary?${(() => { const p = new URLSearchParams(sp.toString()); p.set('page', String(page - 1)); return p.toString(); })()}`}
            className="hover:text-ink"
          >
            ‹ 上一页
          </a>
        )}
        <span>
          {page} / {Math.max(1, Math.ceil(total / pageSize))}
        </span>
        {page * pageSize < total && (
          <a
            href={`/dictionary?${(() => { const p = new URLSearchParams(sp.toString()); p.set('page', String(page + 1)); return p.toString(); })()}`}
            className="hover:text-ink"
          >
            下一页 ›
          </a>
        )}
      </div>
    </div>
  );
}
