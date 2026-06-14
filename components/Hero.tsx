import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { BRAND } from '@/lib/design';
import { LiveStrokeDemo } from './LiveStrokeDemo';

export function Hero() {
  return (
    <section className="relative pt-6 sm:pt-12 pb-10 sm:pb-16 overflow-hidden">
      {/* Vertical text accent (right side, desktop only) */}
      <div
        className="hidden lg:flex absolute right-2 top-6 bottom-6 select-none pointer-events-none font-kai text-ink/15 text-xs leading-[2.4] tracking-[0.6em] flex-col items-center"
        aria-hidden="true"
      >
        <span>漢</span>
        <span>字</span>
        <span>與</span>
        <span>拼</span>
        <span>音</span>
        <span className="my-2 text-seal/30">·</span>
        <span>一</span>
        <span>筆</span>
        <span>一</span>
        <span>畫</span>
        <span>皆</span>
        <span>有</span>
        <span>意</span>
      </div>

      {/* Top brand line + seal */}
      <div className="flex items-center justify-between mb-8 sm:mb-12">
        <div className="font-kai text-xs sm:text-sm text-ink-faint tracking-[0.4em]">
          {BRAND.name}
        </div>
        <div className="stamp text-[10px] sm:text-xs">
          公益 · 免费
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Live stroke demo — left, visual anchor */}
        <div className="lg:col-span-5 flex justify-center lg:justify-end order-2 lg:order-1">
          <div className="relative">
            {/* Decorative surrounding frame */}
            <div className="absolute -inset-4 border border-ink/10 rounded-sm" aria-hidden="true" />
            <div className="absolute -inset-7 border border-ink/5 rounded-sm" aria-hidden="true" />
            <LiveStrokeDemo char="韵" size={260} loopIntervalMs={5500} />
            {/* Caption */}
            <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] sm:text-xs text-ink-faint tracking-[0.3em] font-kai whitespace-nowrap">
              一笔一画 · 韵由字生
            </div>
          </div>
        </div>

        {/* Headline — right, asymmetric */}
        <div className="lg:col-span-7 order-1 lg:order-2">
          <div className="font-kai text-sm sm:text-base text-ink-faint tracking-[0.3em] mb-3">
            漢  字  ·  拼  音
          </div>
          <h1 className="font-serif text-4xl sm:text-6xl lg:text-7xl text-ink leading-[1.1] mb-6 tracking-tight">
            <span className="block">汉字与拼音，</span>
            <span className="block text-seal/90 italic">一笔一画</span>
            <span className="block">皆有意。</span>
          </h1>
          <p className="text-sm sm:text-base text-ink-soft max-w-lg leading-relaxed mb-8">
            {BRAND.shortDesc}。<br className="sm:hidden" />
            字 ↔ 拼音互转 · 千字罕见库 · 字帖打印 · 趣味识字游戏 · 佛经选读。
          </p>
          <div className="flex items-center gap-4 flex-wrap">
            <Link
              href="/dictionary"
              className="btn-seal inline-flex items-center gap-2 px-6 py-3 text-base"
            >
              立即开始 <ArrowRight size={16} />
            </Link>
            <Link
              href="#features"
              className="btn-ghost inline-flex items-center gap-2 px-6 py-3 text-base"
            >
              浏览功能
            </Link>
          </div>

          {/* Inline stats — number-driven, real data */}
          <div className="mt-10 grid grid-cols-3 gap-3 sm:gap-6 max-w-md">
            <Stat number="8105" label="通用规范字" />
            <Stat number="1412" label="罕见字" />
            <Stat number="12" label="部佛经" />
          </div>
        </div>
      </div>

      {/* Brush stroke divider */}
      <svg
        className="mt-14 sm:mt-20 mx-auto block w-full max-w-2xl text-ink/20"
        viewBox="0 0 600 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        aria-hidden="true"
      >
        <path d="M2 12 Q 80 2, 160 12 T 320 12 T 480 12 T 598 12" strokeLinecap="round" />
        <circle cx="300" cy="12" r="3" fill="currentColor" stroke="none" />
      </svg>
    </section>
  );
}

function Stat({ number, label }: { number: string; label: string }) {
  return (
    <div>
      <div className="font-serif text-2xl sm:text-3xl text-ink leading-none">{number}</div>
      <div className="mt-1 text-xs text-ink-faint tracking-widest font-kai">{label}</div>
    </div>
  );
}
