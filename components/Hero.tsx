import Link from 'next/link';
import { BRAND } from '@/lib/design';

export function Hero() {
  return (
    <section className="text-center py-10 sm:py-16">
      <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-4">
        字 · 韵
      </div>
      <h1 className="font-kai text-3xl sm:text-5xl text-ink leading-tight mb-4">
        汉字与拼音，<br className="sm:hidden" />
        一笔一画皆有意
      </h1>
      <p className="text-sm sm:text-base text-ink-soft max-w-xl mx-auto leading-relaxed mb-8">
        {BRAND.shortDesc}。字 ↔ 拼音互转 · 千字罕见库 · 字帖打印 · 趣味识字游戏。
      </p>
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <Link href="/worksheet" className="btn-seal">
          立即开始
        </Link>
        <Link href="#features" className="btn-ghost">
          了解更多
        </Link>
      </div>
    </section>
  );
}
