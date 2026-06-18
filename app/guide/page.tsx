import { Suspense } from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { renderMarkdown } from '@/lib/markdown';
import { GITHUB_REPO_URL } from '@/lib/design';
import { filterUserReadme } from './filter';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '使用指南 · 字·韵',
  description: '字·韵 完整使用说明,基于项目 README 自动生成。',
};

function readReadme(): string {
  // process.cwd() at runtime = repo root for `next dev`/`next start`.
  // Try both locations in case the build runs from a different cwd.
  const candidates = [
    join(process.cwd(), 'README.md'),
    join(process.cwd(), '..', 'README.md'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return '# 使用指南\n\n未找到 README.md。请在 GitHub 查看完整文档。';
}

export default function GuidePage() {
  const md = filterUserReadme(readReadme());
  const html = renderMarkdown(md);
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="max-w-3xl mx-auto py-12 space-y-4">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h1 className="text-3xl font-bold text-ink">使用指南</h1>
            <a
              href={`${GITHUB_REPO_URL}/blob/main/README.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-seal hover:underline"
            >
              在 GitHub 编辑此页 →
            </a>
          </div>
          <p className="text-sm text-ink-soft">
            本页基于项目根目录的 <code className="rounded bg-paper-deep px-1">README.md</code> 自动渲染。文档修改后刷新此页即可看到最新内容。
          </p>
          <div
            className="guide-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
