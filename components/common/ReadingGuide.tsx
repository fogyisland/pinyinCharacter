import { Suspense, type ReactNode } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from './PageContainer';

export interface ReadingTopic {
  id: string;
  title: string;
  passage: string;
  note: string;
  question: string;
  answer: string;
}

export function ReadingGuide({
  title,
  subtitle,
  topics,
  children,
}: {
  title: string;
  subtitle: string;
  topics: readonly ReadingTopic[];
  children?: ReactNode;
}) {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <header className="border-y border-ink/25 bg-paper-soft px-6 py-8 sm:px-12 sm:py-12">
          <h1 className="font-kai text-4xl tracking-wide text-ink sm:text-6xl">{title}</h1>
          <p className="mt-4 max-w-2xl leading-7 text-ink-soft sm:text-lg">{subtitle}</p>
        </header>
        <nav
          aria-label="本页主题"
          className="my-5 flex flex-wrap gap-x-5 border-b border-ink/20 sm:my-8"
        >
          {topics.map((topic) => (
            <a
              key={topic.id}
              href={`#${topic.id}`}
              className="inline-flex min-h-11 items-center border-b-2 border-transparent py-2 hover:border-seal hover:text-seal focus-visible:outline-seal"
            >
              {topic.title}
            </a>
          ))}
        </nav>
        <div className="grid gap-5 md:grid-cols-2 lg:gap-8">
          {topics.map((topic) => (
            <section
              key={topic.id}
              id={topic.id}
              className="scroll-mt-6 space-y-4 border-t-2 border-ink/35 bg-paper-soft p-6 sm:p-8"
            >
              <h2 className="font-kai text-3xl">{topic.title}</h2>
              <p className="border-l-2 border-seal pl-4 font-kai text-2xl leading-relaxed">
                {topic.passage}
              </p>
              <p className="leading-8 text-ink-soft">{topic.note}</p>
              <details className="border-t border-ink/15 pt-1">
                <summary className="min-h-11 cursor-pointer py-3 text-seal focus-visible:outline-seal">
                  {topic.question}
                </summary>
                <p className="pb-2 leading-7">{topic.answer}</p>
              </details>
            </section>
          ))}
        </div>
        {children}
      </PageContainer>
      <Footer />
    </>
  );
}
