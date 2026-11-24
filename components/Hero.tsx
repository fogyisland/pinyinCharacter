import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { LiveStrokeDemo } from './LiveStrokeDemo';

export function Hero() {
  return (
    <section className="relative isolate grid items-center gap-6 py-6 sm:grid-cols-[1fr_1.15fr] sm:gap-8 sm:py-12 lg:min-h-[32rem] lg:gap-16 lg:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 bg-[radial-gradient(ellipse_at_18%_76%,color-mix(in_srgb,var(--color-ink)_9%,transparent),transparent_45%),radial-gradient(ellipse_at_75%_24%,var(--color-paper-soft),transparent_62%)]" />
      <div className="sm:col-start-2 sm:row-start-1">
        <h1 className="font-kai text-[clamp(2.4rem,5.2vw,5rem)] leading-[1.32] text-ink">
          <span className="block">汉字与拼音，</span>
          <span className="inline-block text-seal">一笔一画</span>
          <span className="inline-block">皆有意。</span>
        </h1>
        <p className="my-6 max-w-md leading-8 text-ink-soft">
          查字音与字源，临一页字帖，或循着一首诗走进节令、礼俗与古人的日常。
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dictionary"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-seal px-6 text-paper-soft hover:bg-ink"
          >
            进入字典 <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link
            href="/culture"
            className="inline-flex min-h-11 items-center px-2 text-ink underline decoration-ink/35 underline-offset-8 hover:text-seal"
          >
            游览传统文化
          </Link>
        </div>
      </div>
      <figure className="relative mx-auto flex w-full max-w-md items-center justify-center gap-4 rounded-[50%] bg-[radial-gradient(ellipse_at_38%_43%,var(--color-paper-soft)_20%,transparent_70%)] py-5 sm:col-start-1 sm:row-start-1 sm:py-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[6%] inset-y-[2%] -rotate-12 rounded-[47%_53%_51%_49%] border-t border-l-2 border-ink/20"
        />
        <LiveStrokeDemo char="韵" className="stroke-scroll" size={240} loopIntervalMs={5500} />
        <figcaption className="font-kai text-sm tracking-[.24em] text-ink-soft [writing-mode:vertical-rl]">
          韵 · 笔顺演示
        </figcaption>
      </figure>
    </section>
  );
}
