import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HomePoemCard } from './HomePoemCard';

type BentoItem = {
  char: string;
  title: string;
  description: string;
  href: string;
  variant: 'primary' | 'accent' | 'outline' | 'ink';
};

const ITEMS: BentoItem[] = [
  { char: '字', title: '字 ↔ 拼音互转', description: '文本转拼音 · 整句智能转换', href: '/dictionary', variant: 'primary' },
  { char: '库', title: '罕见字库', description: '1412 个生僻字查询', href: '/rare-chars', variant: 'accent' },
  { char: '帖', title: '字帖打印', description: '毛笔格 / 田字格 PDF', href: '/worksheet', variant: 'outline' },
  { char: '戏', title: '趣味识字游戏', description: '拼音与字配对', href: '/game', variant: 'outline' },
  { char: '经', title: '佛经选读', description: '12 部经分品抄写', href: '/sutra', variant: 'outline' },
];

const variantClass = {
  primary: 'bg-ink text-paper-soft',
  accent: 'bg-seal text-paper-soft',
  ink: 'bg-paper text-ink border border-ink/30',
  outline: 'bg-paper-soft border border-ink/15 text-ink hover:border-ink/40',
} as const;

export function BentoGrid() {
  return (
    <section id="features" className="py-6 sm:py-10">
      {/* Section label */}
      <div className="flex items-end justify-between mb-4 sm:mb-6">
        <h2 className="font-serif text-2xl sm:text-3xl text-ink leading-none">
          <span className="text-seal mr-2">·</span>
          字韵工坊
        </h2>
        <span className="font-kai text-xs text-ink-faint tracking-[0.3em] hidden sm:block">
          五大功能 · 一站通达
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Featured card (left, large) */}
        <Link
          href={ITEMS[0]!.href}
          className={`card-paper col-span-2 sm:row-span-2 ${variantClass[ITEMS[0]!.variant]} p-6 sm:p-8 flex flex-col justify-between min-h-[200px] sm:min-h-[260px] group relative overflow-hidden`}
        >
          {/* Decorative oversized char watermark */}
          <div className="absolute -right-4 -bottom-6 font-kai text-[180px] leading-none opacity-[0.07] pointer-events-none select-none" aria-hidden="true">
            {ITEMS[0]!.char}
          </div>
          <div className="font-kai text-5xl sm:text-6xl leading-none relative z-10">
            {ITEMS[0]!.char}
          </div>
          <div className="relative z-10">
            <div className="font-serif text-xl sm:text-2xl mb-1">{ITEMS[0]!.title}</div>
            <div className="text-sm opacity-75 mb-3">{ITEMS[0]!.description}</div>
            <div className="flex items-center gap-1 text-sm font-kai">
              进入功能 <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>
        </Link>

        {/* Standard cards */}
        {ITEMS.slice(1, 4).map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`card-paper ${variantClass[item.variant]} p-4 sm:p-5 flex flex-col justify-between min-h-[120px] group`}
          >
            <div className="font-kai text-3xl sm:text-4xl leading-none">{item.char}</div>
            <div>
              <div className="font-semibold text-sm sm:text-base leading-tight">{item.title}</div>
              <div className="text-xs opacity-70 mt-0.5">{item.description}</div>
            </div>
          </Link>
        ))}

        {/* Fifth card — Sutra, full width on sm */}
        <Link
          href={ITEMS[4]!.href}
          className={`card-paper ${variantClass[ITEMS[4]!.variant]} col-span-2 sm:col-span-1 p-4 sm:p-5 flex flex-col justify-between min-h-[120px] group`}
        >
          <div className="font-kai text-3xl sm:text-4xl leading-none">{ITEMS[4]!.char}</div>
          <div>
            <div className="font-semibold text-sm sm:text-base leading-tight">{ITEMS[4]!.title}</div>
            <div className="text-xs opacity-70 mt-0.5">{ITEMS[4]!.description}</div>
          </div>
        </Link>

        {/* Live poem card — full width */}
        <div className="col-span-2 sm:col-span-3 lg:col-span-4">
          <HomePoemCard />
        </div>
      </div>
    </section>
  );
}
