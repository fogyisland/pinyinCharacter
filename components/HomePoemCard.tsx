import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getRandomPoem } from '@/lib/poetry';

export async function HomePoemCard() {
  const poem = await getRandomPoem();
  if (!poem) {
    return (
      <Link
        href="/poetry"
        className="card-paper p-5 flex flex-col gap-2 group"
      >
        <div className="font-kai text-3xl">诗</div>
        <div className="font-semibold">古诗词</div>
        <div className="text-xs text-ink-soft">唐诗三百首 · 宋词三百首</div>
      </Link>
    );
  }
  const firstLine = poem.content[0] ?? '';
  const displayLine = firstLine.length > 5 ? firstLine.slice(0, 5) + '…' : firstLine;

  return (
    <Link
      href={`/poetry/${poem.id}`}
      className="card-paper p-5 flex flex-col gap-2 group hover:border-seal transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="font-kai text-3xl">诗</div>
        <span className="inline-block px-1.5 py-0.5 bg-seal/10 text-seal text-xs rounded">
          {poem.dynasty === 'tang' ? '唐' : '宋'}
        </span>
      </div>
      <div className="font-semibold">《{poem.title}》</div>
      <div className="font-kai text-base text-ink-soft truncate">{displayLine}</div>
      <div className="text-xs text-ink-faint">{poem.author}</div>
      <div className="flex items-center gap-1 text-sm font-kai text-ink-soft group-hover:text-seal transition-colors mt-1">
        展开字帖 <ArrowRight size={14} />
      </div>
    </Link>
  );
}
