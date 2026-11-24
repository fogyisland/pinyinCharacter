import Link from 'next/link';
import type { ClassicListItem } from '@/lib/classics-types';

const CATEGORY_LABELS: Record<string, string> = {
  'four-books': '四书',
  'five-classics': '五经',
  mengxue: '蒙学',
  philosophy: '诸子',
  history: '史书',
  other: '其他',
  pianwen: '骈文与对韵',
};

export function ClassicCard({ item }: { item: ClassicListItem }) {
  return (
    <Link
      href={`/ancient/${item.slug}`}
      className="catalog-entry group"
    >
      <h3 className="font-kai text-2xl text-ink leading-tight group-hover:text-seal transition-colors">
        《{item.title}》
      </h3>
      <div className="text-xs text-ink-faint">
        {[item.author, item.era].filter(Boolean).join(' · ')}
      </div>
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="inline-block px-1.5 py-0.5 bg-seal/10 text-seal text-xs rounded">
          {CATEGORY_LABELS[item.category] ?? item.category}
        </span>
        <span className="text-xs text-ink-faint">
          {item.chunkCount} 章 · {item.charCount} 字
        </span>
      </div>
    </Link>
  );
}
