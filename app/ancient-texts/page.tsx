import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '古籍 · 字·韵',
  description: '字·韵 古籍模块:经史子集等经典文本,提供原文、断句、注释对照与生字长句的拼音注释。',
};

export default function AncientTextsPage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="max-w-3xl mx-auto py-12 space-y-6">
          <h1 className="text-3xl font-bold text-ink">古籍 / Classical Texts</h1>

          <p className="text-base text-ink-soft leading-relaxed">
            古籍模块筹备中。计划收录经史子集等经典文本,提供原文、断句、注释对照,以及对生字、长句的拼音注释。
            让你在读古文时,既能看到原汁原味的经典,也能随时查字、读音、释义。敬请期待。
          </p>

          <div className="card-paper rounded-lg p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink">先逛逛这些</h2>
            <ul className="text-sm text-ink-soft space-y-1 list-disc list-inside">
              <li>
                <Link href="/sutra" className="text-seal hover:underline">佛经</Link>
                <span className="ml-1">— 已有的佛经阅读模块,带分章/拼音注释</span>
              </li>
              <li>
                <Link href="/dictionary" className="text-seal hover:underline">字典</Link>
                <span className="ml-1">— 查字形、字义、字源、读音</span>
              </li>
            </ul>
          </div>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
