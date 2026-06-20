import Link from 'next/link';

interface Props {
  current: string | 'all';
  counts: Record<string, number>;
}

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'four-books', label: '四书' },
  { value: 'five-classics', label: '五经' },
  { value: 'mengxue', label: '蒙学' },
  { value: 'philosophy', label: '诸子' },
  { value: 'history', label: '史书' },
];

export function ClassicCategoryNav({ current, counts }: Props) {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-2 mb-6 border-b border-ink/10" aria-label="古籍分类">
      {CATEGORIES.map((c) => {
        const active = current === c.value;
        const href = c.value === 'all' ? '/ancient' : `/ancient?category=${c.value}`;
        const n = c.value === 'all'
          ? Object.values(counts).reduce((s, v) => s + v, 0)
          : (counts[c.value] ?? 0);
        return (
          <Link
            key={c.value}
            href={href}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
              active ? 'bg-seal text-white' : 'bg-paper-deep text-ink-soft hover:bg-ink/10'
            }`}
          >
            {c.label} <span className="ml-1 opacity-70">({n})</span>
          </Link>
        );
      })}
    </nav>
  );
}