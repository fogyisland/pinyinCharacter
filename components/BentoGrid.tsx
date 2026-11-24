import { HomeDirectory } from './HomeDirectory';
import { HomePoemCard } from './HomePoemCard';

export function BentoGrid() {
  return (
    <section id="features" className="py-8 sm:py-12">
      <div className="mb-6 flex items-center gap-5">
        <h2 className="shrink-0 font-kai text-3xl sm:text-4xl">全站目录</h2>
        <span aria-hidden="true" className="h-px grow bg-gradient-to-r from-ink/30 to-transparent" />
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-[1.7fr_1fr] lg:gap-14">
        <HomeDirectory />
        <HomePoemCard />
      </div>
    </section>
  );
}
