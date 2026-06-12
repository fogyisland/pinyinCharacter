import Link from 'next/link';
import type { PoemListItem } from '@/lib/poetry-types';

const DYNASTY_LABEL = { tang: '唐', song: '宋' } as const;

export function PoemCard({ poem }: { poem: PoemListItem }) {
  return (
    <Link
      href={`/poetry/${poem.id}`}
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
