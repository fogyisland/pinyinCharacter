import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HomePoemCard } from './HomePoemCard';

type BentoItem = {
  char: string;
  title: string;
  description: string;
  href: string;
  variant: 'primary' | 'accent' | 'outline';
};

const ITEMS: BentoItem[] = [
  { char: '字', title: '字 ↔ 拼音互转', description: '文本转拼音 + 整句转换', href: '/', variant: 'primary' },
  { char: '库', title: '罕见字库', description: '1450 个生僻字查询', href: '/rare-chars', variant: 'accent' },
  { char: '帖', title: '字帖打印', description: '毛笔格/田字格 PDF', href: '/worksheet', variant: 'outline' },
  { char: '戏', title: '趣味识字游戏', description: '拼音与字配对', href: '/game', variant: 'outline' },
  { char: '经', title: '佛经选读', description: '12 部经分品抄写', href: '/sutra', variant: 'outline' },
];

const variantClass = {
  primary: 'bg-ink text-paper-soft',
  accent: 'bg-seal text-paper-soft',
  outline: 'bg-paper-soft border border-ink/20 text-ink',
} as const;

export function BentoGrid() {
  return (
    <section id="features" className="py-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link
          href={ITEMS[0]!.href}
          className={`card-paper ${variantClass[ITEMS[0]!.variant]} sm:row-span-2 p-6 flex flex-col justify-between min-h-[200px] group`}
        >
          <div className="font-kai text-6xl leading-none">{ITEMS[0]!.char}</div>
          <div>
            <div className="font-semibold text-lg mb-1">{ITEMS[0]!.title}</div>
            <div className="text-sm opacity-75 mb-2">{ITEMS[0]!.description}</div>
            <div className="flex items-center gap-1 text-sm font-kai">
              立即开始 <ArrowRight size={14} />
            </div>
          </div>
        </Link>
        {ITEMS.slice(1).map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`card-paper ${variantClass[item.variant]} p-5 flex items-center gap-4 group`}
          >
            <div className="font-kai text-3xl">{item.char}</div>
            <div>
              <div className="font-semibold">{item.title}</div>
              <div className="text-xs opacity-75">{item.description}</div>
            </div>
          </Link>
        ))}
        <HomePoemCard />
      </div>
    </section>
  );
}
