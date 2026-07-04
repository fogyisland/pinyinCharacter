import Link from 'next/link';
import type { PoemListItem } from '@/lib/poetry-types';

const DYNASTY_LABEL: Record<string, string> = { tang: '唐', song: '宋', 汉: '汉', 魏: '魏', 三国: '三国', 汉末: '汉末', 汉乐府: '汉乐府', 古诗十九首: '古诗十九首', 骈文: '骈文', yuan: '元', qing: '清', mixed: '诸' };

export function PoemCard({ poem, backHref }: { poem: PoemListItem; backHref?: string }) {
  // 2026-07-04: when the list page passes its current URL search as
  // backHref (e.g. '/poetry?form=%E4%BA%94%E8%A8%80'), append it
  // URL-encoded to the detail href so /poetry/[id] can read it back via
  // getPoetryBackLink and round-trip the user to the same filtered view.
  const href = backHref
    ? `/poetry/${poem.id}?back=${encodeURIComponent(backHref)}`
    : `/poetry/${poem.id}`;
  return (
    <Link
      href={href}
      className="card-paper p-4 flex flex-col gap-2 hover:border-seal transition-colors group"
    >
      <h3 className="font-kai text-lg text-ink leading-tight group-hover:text-seal transition-colors">
        《{poem.title}》
      </h3>
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="inline-block px-1.5 py-0.5 bg-seal/10 text-seal text-xs rounded">
          {DYNASTY_LABEL[poem.dynasty]}
        </span>
        <span>{poem.author}</span>
        {poem.form && <span className="text-ink-faint text-xs">· {poem.form}</span>}
      </div>
    </Link>
  );
}
