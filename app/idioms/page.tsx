import type { Metadata } from 'next';
import { ReadingGuide } from '@/components/common/ReadingGuide';
import { buildMetadata } from '@/lib/seo/metadata';
import idioms from '@/data/idioms.json';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '成语典故 · 字·韵',
    description: '按成语或释义检索成语词目，从出处读懂一条成语怎样用到今天。',
    path: '/idioms',
    ogType: 'website',
  });
}

export default async function IdiomsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const raw = (await searchParams).q;
  const query = typeof raw === 'string' ? raw.trim() : '';
  const matches = idioms.filter(
    (item) => item.word.includes(query) || item.meaning.includes(query),
  );
  return (
    <ReadingGuide
      title="成语典故"
      subtitle="先读出处，再看四个字怎样用到今天"
      topics={[
        {
          id: 'shouzhudaitu',
          title: '守株待兔',
          passage: '兔走触株，折颈而死。',
          note: '《韩非子·五蠹》写宋人偶然得到一只撞上树桩的兔子，便放下农具，天天守候。这里的“走”是跑，“株”是树桩。',
          question: '用它形容哪一种做法？',
          answer: '把一次偶然的收获当成以后也能照搬的方法。例如只等上次考试的原题再出现。',
        },
        {
          id: 'wangyangbulao',
          title: '亡羊补牢',
          passage: '亡羊而补牢，未为迟也。',
          note: '见《战国策·楚策四》，庄辛借这句俗语劝楚襄王及时补救。亡是丢失，牢在这里指畜圈。',
          question: '如果羊圈已经破了，该先做什么？',
          answer: '修好缺口，防止再丢。今天常用它表示出了问题后采取措施，仍然有意义。',
        },
      ]}
    >
      <section className="mt-8">
        <h2 className="font-kai text-2xl">查成语</h2>
        <form action="/idioms" className="my-4 flex gap-2">
          <input
            aria-label="输入成语或释义"
            name="q"
            defaultValue={query}
            placeholder="输入成语或释义"
            className="min-w-0 rounded border px-3 py-2"
          />
          <button className="btn-seal">查询</button>
        </form>
        <p className="text-sm text-ink-soft">
          {query ? `找到 ${matches.length} 条` : `共 ${idioms.length} 条，以下为精选示例`}
        </p>
        <dl>
          {(query ? matches : matches.slice(0, 8)).map((item) => (
            <div key={item.word} className="border-b border-ink/10 py-3">
              <dt>
                {item.word} · {item.pinyin}
              </dt>
              <dd className="text-ink-soft">{item.meaning}</dd>
            </div>
          ))}
        </dl>
      </section>
    </ReadingGuide>
  );
}
