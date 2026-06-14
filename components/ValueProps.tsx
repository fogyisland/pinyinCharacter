const PROPS = [
  {
    title: '准',
    subtitle: '准确',
    body: '基于 16 万条语料统计的 Viterbi 整句智能转换',
    accent: 'bg-ink text-paper-soft',
  },
  {
    title: '丰',
    subtitle: '丰富',
    body: '8105 个通用规范汉字 + 1412 个罕见字 + 历代字源',
    accent: 'bg-seal text-paper-soft',
  },
  {
    title: '易',
    subtitle: '易用',
    body: '字帖一键打印，毛笔格 / 田字格 / 米字格全支持',
    accent: 'bg-ink/85 text-paper-soft',
  },
] as const;

export function ValueProps() {
  return (
    <section className="py-8 sm:py-12">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {PROPS.map((p, i) => (
          <div
            key={p.title}
            className="card-paper p-5 sm:p-6 flex items-center gap-4 sm:gap-5 group"
          >
            <div
              className={`flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 ${p.accent} font-kai text-3xl sm:text-4xl flex items-center justify-center rounded-sm`}
            >
              {p.title}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-serif text-base sm:text-lg text-ink mb-1">{p.subtitle}</div>
              <p className="text-xs sm:text-sm text-ink-soft leading-relaxed">{p.body}</p>
            </div>
            <div
              className="hidden sm:flex flex-shrink-0 w-7 h-7 border border-ink/20 rounded-full items-center justify-center text-xs text-ink-faint font-kai"
              aria-hidden="true"
            >
              {String(i + 1).padStart(2, '0')}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
