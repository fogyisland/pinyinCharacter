import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { buildMetadata } from '@/lib/seo/metadata';
import { lessons } from './lessons';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '书法入门 · 字·韵',
    description: '用八堂习字课练习笔画、结体、书体观察和临摹。每课配有范字、字帖和自查方法。',
    path: '/calligraphy',
    ogType: 'website',
  });
}

export default function CalligraphyPage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <header className="grid items-center gap-5 border-y border-ink/30 bg-paper-soft px-6 py-8 sm:grid-cols-[1fr_auto] sm:p-12">
          <div>
            <h1 className="font-kai text-4xl sm:text-6xl">书法入门</h1>
            <p className="mt-4 max-w-xl leading-8 text-ink-soft">
              准备一支笔、一张方格纸。从“三”的三道横画开始，逐课练习笔画、结体和临摹。每课选一个字，对照范字写两遍。
            </p>
          </div>
          <div
            aria-hidden="true"
            className="hidden border border-ink/25 bg-[linear-gradient(90deg,transparent_49.5%,var(--color-paper-deep)_50%,transparent_50.5%),linear-gradient(transparent_49.5%,var(--color-paper-deep)_50%,transparent_50.5%)] px-6 font-kai text-8xl leading-[1.5] text-ink sm:block"
          >
            永
          </div>
        </header>
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[13rem_1fr]">
          <nav aria-label="书法课程" className="border-t-2 border-seal lg:sticky lg:top-4">
            <h2 className="my-4 font-kai text-2xl">习字课程</h2>
            <ul className="grid grid-cols-2 gap-x-3 lg:grid-cols-1">
              {lessons.map((lesson) => (
                <li key={lesson.id}>
                  <a
                    className="inline-flex min-h-11 items-center text-ink-soft underline-offset-4 hover:text-seal hover:underline"
                    href={`#${lesson.id}`}
                  >
                    {lesson.title}
                  </a>
                </li>
              ))}
            </ul>
            <Link
              href="/worksheet/practice"
              className="mt-3 inline-flex min-h-11 items-center text-seal underline"
            >
              选空白练字模板
            </Link>
          </nav>
          <div className="space-y-6">
            {lessons.map((lesson) => (
              <section
                key={lesson.id}
                id={lesson.id}
                className="scroll-mt-4 border-t-2 border-ink/30 bg-paper-soft p-5 sm:p-8"
              >
                <h2 className="font-kai text-3xl">{lesson.title}</h2>
                <p className="mt-3 max-w-prose leading-8 text-ink-soft">{lesson.look}</p>
                <div className="my-5 flex flex-wrap gap-3">
                  {Array.from(lesson.chars).map((char) => (
                    <Link
                      key={char}
                      aria-label={`用${char}生成字帖`}
                      href={`/worksheet?prefill=${encodeURIComponent(char)}`}
                      className="group flex items-center gap-3 border border-ink/20 p-3 hover:border-seal"
                    >
                      <span className="font-kai text-4xl">{char}</span>
                      <span className="text-sm text-seal group-hover:underline">练此字</span>
                    </Link>
                  ))}
                </div>
                <ol className="list-decimal space-y-2 pl-6 leading-7">
                  {lesson.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <details className="mt-4 border-t border-ink/15">
                  <summary className="cursor-pointer py-3 text-seal">写完怎样自查？</summary>
                  <p className="leading-7">{lesson.check}</p>
                </details>
                {lesson.id === 'scripts' && (
                  <Link
                    className="inline-flex min-h-11 items-center text-seal underline"
                    href="/etymology/山"
                  >
                    对照“山”的历代字形
                  </Link>
                )}
              </section>
            ))}
          </div>
        </div>
        <section
          aria-labelledby="models-title"
          className="mt-10 border-y border-ink/25 py-7 sm:py-10"
        >
          <h2 id="models-title" className="font-kai text-3xl">
            怎样读一页碑帖
          </h2>
          <p className="mt-3 max-w-prose leading-8 text-ink-soft">
            找一页清晰的碑帖，先看整行的疏密，再挑一个完整的字细看。下面三件作品，各适合带着一个问题去读。
          </p>
          <dl className="mt-6 grid gap-6 md:grid-cols-3">
            <div>
              <dt className="font-kai text-xl">隶书 ·《曹全碑》</dt>
              <dd className="mt-2 leading-7">
                看东汉碑刻的横向舒展。在同一行里选两个长横，比较收笔处的轻重，再找一笔写得含蓄的短横。
              </dd>
            </div>
            <div>
              <dt className="font-kai text-xl">楷书 ·《九成宫醴泉铭》</dt>
              <dd className="mt-2 leading-7">
                看唐代欧阳询怎样安排紧密的点画。挑一个左右结构的字，用纸条分别遮住左右两边，观察每一边占多宽。
              </dd>
            </div>
            <div>
              <dt className="font-kai text-xl">行书 ·《兰亭序》传世摹本</dt>
              <dd className="mt-2 leading-7">
                找两处“之”，比较末笔的方向和长短。把前后相邻的字一起看，观察同一字怎样随行气变化。
              </dd>
            </div>
          </dl>
        </section>
      </PageContainer>
      <Footer />
    </>
  );
}
