const PROPS = [
  { title: '准确', body: '基于 16 万条语料统计的 Viterbi 整句转换', icon: '✓' },
  { title: '丰富', body: '1450 个通用规范三级字 + 词条', icon: '典' },
  { title: '易用', body: '字帖一键打印，支持毛笔格与田字格', icon: '印' },
];

export function ValueProps() {
  return (
    <section className="py-10">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {PROPS.map(p => (
          <div key={p.title} className="text-center">
            <div className="font-kai text-3xl text-seal mb-2">{p.icon}</div>
            <div className="font-semibold text-ink mb-1">{p.title}</div>
            <p className="text-sm text-ink-soft leading-relaxed">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
