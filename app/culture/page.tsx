import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { buildMetadata } from '@/lib/seo/metadata';
import { readings } from './readings';
import { cultureFacts, quickReferences } from './culture-facts';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '传统文化 · 字·韵',
    description:
      '岁时、礼俗、人物、诸子、技艺五大主题，三十五篇经典导读与国学常识速查，循引文直读诗词与古籍原文。',
    path: '/culture',
    ogType: 'website',
  });
}

const topics = [
  {
    id: 'seasons',
    ordinal: '壹',
    title: '岁时节令',
    subtitle: '四时流转 · 节令与农事',
    passage: '清明前后，种瓜点豆。',
    note: '这句农谚把春播与清明联系起来。节气以太阳在黄道上的位置划分，实际播种还要看当地的气温与土壤。',
    question: '清明与端午，哪个也是节气？',
    answer: '清明既是节气，也是节日。端午在农历五月初五。',
  },
  {
    id: 'customs',
    ordinal: '贰',
    title: '礼仪民俗',
    subtitle: '称谓有度 · 礼在其中',
    passage: '名丘，字仲尼。',
    note: '古人除了名，还可能有字和号。读人物传记时，先把同一人的不同称呼放在一起，就能分清叙事里的人物。',
    question: '仲尼与孔子是什么关系？',
    answer: '两者都指孔丘。仲尼是他的字，“子”在孔子这一称呼中表示尊敬。',
  },
  {
    id: 'people',
    ordinal: '叁',
    title: '历史人物',
    subtitle: '知人论世 · 读传观史',
    passage: '太史公写屈原。',
    note: '屈原生活在战国楚国，司马迁生活在西汉。《史记·屈原贾生列传》是后代史家为前人作传的例子。',
    question: '读列传时应区分哪两个时代？',
    answer: '传主所处的时代，以及作者著书的时代。这里分别是战国与西汉。',
  },
  {
    id: 'thought',
    ordinal: '肆',
    title: '诸子百家',
    subtitle: '百家争鸣 · 义理源流',
    passage: '己所不欲，勿施于人。',
    note: '《论语·卫灵公》记载，子贡问有没有可以终身奉行的一句话，孔子用“恕”来回答。先读懂这个问答，再比较墨家“兼爱”等主张。',
    question: '同学不愿被取笑，这句话怎样用？',
    answer:
      '设身处地去想，自己不愿遭受的对待，也不要加在别人身上。这是从日常相处理解“恕”的一种办法。',
  },
  {
    id: 'crafts',
    ordinal: '伍',
    title: '传统技艺',
    subtitle: '百工之事 · 器以载道',
    passage: '蒸之，捣之，拍之，焙之，穿之，封之，茶之干矣。',
    note: '陆羽《茶经·三之造》以一串动词记录饼茶制作。把动词按顺序读一遍，就像沿着制茶工序走了一遍。',
    question: '“拍”与“焙”哪个在前？',
    answer: '先拍打成形，再焙干。这里记的是唐代饼茶的一种制法。',
  },
] as const;

const totalReadings = Object.values(readings).reduce((sum, items) => sum + items.length, 0);
const totalFacts = Object.values(cultureFacts).reduce((sum, items) => sum + items.length, 0);

export default function CulturePage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <header className="publication-heading">
          <div className="mb-2 font-kai text-sm tracking-widest text-seal">
            五大题域 · {totalReadings} 篇导读 · {totalFacts} 则常识
          </div>
          <h1>传统文化</h1>
          <p>
            从时令、称谓、人物、义理到百工，循引文直读诗词与古籍原篇。每个主题先读经典句子，再查国学常识，最后回到原文。
          </p>
        </header>

        {/* 主题目录：用户可达的锚点入口 */}
        <nav
          id="culture-index"
          aria-label="文化主题目录"
          className="mb-12 scroll-mt-6 border-y-2 border-ink/30 py-4"
        >
          <div className="mb-3 font-kai text-xs tracking-[0.3em] text-ink-faint">
            目录 · 选一个主题进入
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a
              href="#quick-ref"
              className="inline-flex min-h-11 items-center font-kai text-lg text-seal underline decoration-seal/40 underline-offset-8 hover:decoration-seal"
            >
              国学常识速查
            </a>
            {topics.map((topic) => (
              <a
                key={topic.id}
                href={`#${topic.id}`}
                className="inline-flex min-h-11 items-center px-2 text-ink-soft underline decoration-ink/25 underline-offset-8 hover:text-seal"
              >
                <span className="mr-2 font-kai text-xs text-ink-faint">{topic.ordinal}</span>
                {topic.title}
              </a>
            ))}
          </div>
        </nav>

        {/* 国学常识速查 */}
        <section id="quick-ref" aria-labelledby="quick-ref-title" className="mb-16 scroll-mt-6">
          <div className="mb-6 flex items-baseline gap-5">
            <h2 id="quick-ref-title" className="shrink-0 font-kai text-3xl text-ink sm:text-4xl">
              国学常识速查
            </h2>
            <span
              aria-hidden="true"
              className="h-px grow bg-gradient-to-r from-ink/30 to-transparent"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {quickReferences.map((ref) => (
              <div key={ref.label} className="border-t-2 border-ink/30 bg-paper-soft p-5 sm:p-6">
                <h3 className="font-kai text-xl text-ink">{ref.label}</h3>
                <p className="mt-3 flex flex-wrap gap-1.5">
                  {ref.items.map((item) => (
                    <span
                      key={item}
                      className="border border-ink/15 bg-paper px-2 py-1 font-kai text-sm text-ink"
                    >
                      {item}
                    </span>
                  ))}
                </p>
                <p className="mt-3 text-xs leading-6 text-ink-soft">{ref.note}</p>
              </div>
            ))}
          </div>
          <a className="mt-5 inline-block text-sm text-ink-soft underline" href="#culture-index">
            返回主题目录
          </a>
        </section>

        {/* 五大主题 */}
        {topics.map((topic) => {
          const topicReadings = readings[topic.id];
          const topicFacts = cultureFacts[topic.id] ?? [];
          return (
            <section
              key={topic.id}
              id={topic.id}
              aria-labelledby={`${topic.id}-title`}
              className="mb-16 scroll-mt-6 border-t-2 border-ink/30 pt-8 sm:mb-24 sm:pt-12"
            >
              {/* 主题题头 */}
              <div className="mb-8 grid items-end gap-4 sm:grid-cols-[auto_1fr] sm:gap-8">
                <span
                  aria-hidden="true"
                  className="font-kai text-6xl leading-none text-seal/25 sm:text-7xl"
                >
                  {topic.ordinal}
                </span>
                <div>
                  <h2 id={`${topic.id}-title`} className="font-kai text-3xl text-ink sm:text-4xl">
                    {topic.title}
                  </h2>
                  <p className="mt-1 font-kai text-sm tracking-widest text-ink-faint">
                    {topic.subtitle}
                  </p>
                </div>
              </div>

              <p className="border-l-[3px] border-seal pl-4 font-kai text-xl leading-relaxed sm:text-2xl">
                {topic.passage}
              </p>
              <p className="mt-3 max-w-3xl leading-7 text-ink-soft">{topic.note}</p>

              {/* 经典导读 */}
              <div className="mt-8 flex items-baseline gap-5">
                <h3 className="shrink-0 font-kai text-xl text-ink">经典导读</h3>
                <span aria-hidden="true" className="h-px grow bg-ink/15" />
                <span className="shrink-0 text-xs text-ink-faint">{topicReadings.length} 篇</span>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {topicReadings.map((reading, index) => (
                  <article
                    key={reading.title}
                    className="flex flex-col gap-3 bg-gradient-to-br from-paper-soft to-transparent px-5 py-6 sm:p-7"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-kai text-lg text-ink sm:text-xl">{reading.title}</h4>
                      <span aria-hidden="true" className="font-kai text-xs text-ink-faint">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <blockquote className="border-l-2 border-seal/60 pl-3 font-kai text-base leading-relaxed text-ink sm:text-lg">
                      {reading.quote}
                    </blockquote>
                    <p className="leading-7 text-ink-soft">{reading.note}</p>
                    <Link
                      href={reading.href}
                      prefetch={false}
                      className="mt-auto self-start text-sm text-seal underline underline-offset-4"
                    >
                      读原文 · {reading.source}
                    </Link>
                  </article>
                ))}
              </div>

              {/* 国学常识卡 */}
              <div className="mt-10 flex items-baseline gap-5">
                <h3 className="shrink-0 font-kai text-xl text-ink">国学常识</h3>
                <span aria-hidden="true" className="h-px grow bg-ink/15" />
                <span className="shrink-0 text-xs text-ink-faint">{topicFacts.length} 则</span>
              </div>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                {topicFacts.map((fact) => (
                  <div key={fact.term} className="border border-ink/20 bg-paper-soft p-5 sm:p-6">
                    <dt className="font-kai text-xl text-ink">{fact.term}</dt>
                    <dd className="mt-2 text-sm font-medium text-seal">{fact.summary}</dd>
                    <dd className="mt-2 text-sm leading-7 text-ink-soft">{fact.detail}</dd>
                  </div>
                ))}
              </dl>

              {/* 自测与返回 */}
              <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-ink/15 pt-5">
                <details className="max-w-2xl">
                  <summary className="min-h-11 cursor-pointer font-kai text-lg text-seal">
                    想一想：{topic.question}
                  </summary>
                  <p className="mt-2 leading-7 text-ink-soft">{topic.answer}</p>
                </details>
                <a className="text-sm text-ink-soft underline" href="#culture-index">
                  返回主题目录 ↑
                </a>
              </div>
            </section>
          );
        })}
      </PageContainer>
      <Footer />
    </>
  );
}
