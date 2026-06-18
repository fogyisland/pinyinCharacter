import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { readAboutIntro, DEFAULT_INTRO } from '@/lib/about-config';
import { AboutIntro } from '@/components/about/AboutIntro';
import { GITHUB_REPO_URL, GITHUB_ISSUES_URL } from '@/lib/design';
import { getCurrentUserWithAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '关于 · 字·韵',
  description: '字·韵 项目介绍 + GitHub 反馈入口',
};

export default async function AboutPage() {
  const cached = await readAboutIntro();
  const user = await getCurrentUserWithAdmin();
  const text = cached.text || DEFAULT_INTRO;
  const generatedAt = cached.generatedAt;
  const isAi = cached.isAi;
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="max-w-3xl mx-auto py-12 space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-ink">关于字·韵</h1>
            <p className="mt-2 text-ink-soft">
              一个面向汉字学习者的公益工具站,免费 + 开源 + 无追踪。
            </p>
          </div>

          <AboutIntro
            initialText={text}
            initialGeneratedAt={generatedAt}
            isAi={isAi}
            isAdmin={!!user?.isAdmin}
          />

          <section className="border-t border-paper-warm pt-6 space-y-3">
            <h2 className="text-lg font-semibold text-ink">反馈 / 参与</h2>
            <ul className="text-sm text-ink-soft space-y-1">
              <li>
                ·{' '}
                <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer"
                   className="text-seal hover:underline">
                  {GITHUB_REPO_URL}
                </a>{' '}
                — 源代码、README、license
              </li>
              <li>
                ·{' '}
                <a href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer"
                   className="text-seal hover:underline">
                  {GITHUB_ISSUES_URL}
                </a>{' '}
                — bug 反馈 / 功能建议
              </li>
              <li>· 邮箱 / Discord 见 GitHub README</li>
            </ul>
          </section>

          <section className="border-t border-paper-warm pt-6 space-y-2">
            <h2 className="text-lg font-semibold text-ink">版权</h2>
            <p className="text-sm text-ink-soft">
              字·韵项目 · MIT License · 数据归原作者所有(《通用规范汉字表》、CBETA 佛经、相关字库)。
            </p>
          </section>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}