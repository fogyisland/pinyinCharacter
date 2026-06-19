import Link from 'next/link';
import type { SutraListItem } from '@/lib/sutra-types';

export function SutraCard({ sutra }: { sutra: SutraListItem }) {
  return (
    <Link
      href={`/sutra/${sutra.id}?from=sutras`}
      className="card-paper p-4 flex flex-col gap-2 hover:border-seal transition-colors group"
    >
      <h3 className="font-kai text-lg text-ink leading-tight group-hover:text-seal transition-colors">
        《{sutra.title}》
      </h3>
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="inline-block px-1.5 py-0.5 bg-seal/10 text-seal text-xs rounded">
          {sutra.chunkCount > 1 ? `${sutra.chunkCount} 品` : '全文'}
        </span>
        <span className="text-ink-faint text-xs">{sutra.charCount} 字</span>
      </div>
    </Link>
  );
}
