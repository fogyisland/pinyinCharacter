import Link from 'next/link';
import { ArrowRight, Quote } from 'lucide-react';
import { getRandomPoem } from '@/lib/poetry';

export async function HomePoemCard() {
  const poem = await getRandomPoem();
  if (!poem) {
    return (
      <Link
        href="/poetry"
        className="card-paper p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 group"
      >
        <div className="font-kai text-4xl sm:text-5xl">诗</div>
        <div>
          <div className="font-semibold text-lg">古诗词</div>
          <div className="text-xs text-ink-soft">唐诗三百首 · 宋词三百首</div>
        </div>
      </Link>
    );
  }
  const firstLine = poem.content[0] ?? '';
  const displayLine = firstLine.length > 14 ? firstLine.slice(0, 14) + '…' : firstLine;

  return (
    <Link
      href={`/poetry/${poem.id}`}
      className="card-paper p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 group relative overflow-hidden"
    >
      {/* Decorative oversized char */}
      <div className="absolute -right-2 -top-4 font-kai text-[160px] sm:text-[200px] leading-none text-ink/[0.04] pointer-events-none select-none" aria-hidden="true">
        诗
      </div>
      {/* Big char badge */}
      <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-sm bg-paper-deep flex items-center justify-center font-kai text-3xl sm:text-4xl text-ink relative z-10">
        诗
      </div>
      <div className="flex-1 min-w-0 relative z-10">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="inline-block px-2 py-0.5 bg-seal/10 text-seal text-xs rounded-sm font-kai">
            {poem.dynasty === 'tang' ? '唐诗' : '宋词'}
          </span>
          <span className="text-xs text-ink-faint">每日一诗</span>
        </div>
        <div className="font-serif text-lg sm:text-xl text-ink leading-tight mb-1">
          《{poem.title}》
          <span className="text-ink-soft text-sm ml-2">· {poem.author}</span>
        </div>
        <div className="font-kai text-sm sm:text-base text-ink-soft truncate flex items-center gap-1.5">
          <Quote size={12} className="flex-shrink-0 text-ink-faint" />
          {displayLine}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-sm font-kai text-ink-soft group-hover:text-seal transition-colors relative z-10 whitespace-nowrap">
        展卷 <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  );
}
