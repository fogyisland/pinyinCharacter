import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getPoem } from '@/lib/poetry';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { PoemMeta } from '@/components/poetry/PoemMeta';
import { PoemViewer } from '@/components/poetry/PoemViewer';
import { AppreciationBlock } from '@/components/poetry/AppreciationBlock';
import { SaveAsWorksheetButton } from './SaveAsWorksheetButton';
import { PrintButton } from '@/components/common/PrintButton';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import { buildMetadata } from '@/lib/seo/metadata';
import { buildCreativeWork, buildBreadcrumbList } from '@/lib/seo/jsonld';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return {};
  const poem = await getPoem(id);
  if (!poem) return {};
  const excerpt = poem.content.slice(0, 2).join(' / ').slice(0, 80);
  return await buildMetadata({
    title: `${poem.title} - ${poem.author}`,
    description: `${poem.author}《${poem.title}》: ${excerpt}`,
    path: `/poetry/${id}`,
    ogType: 'article',
  });
}

export default async function PoemDetailPage({ params }: Props) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const poem = await getPoem(id);
  if (!poem) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildCreativeWork(poem)) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            await buildBreadcrumbList([
              { name: '首页', url: '/' },
              { name: '诗词', url: '/poetry' },
              { name: poem.title, url: `/poetry/${poem.id}` },
            ])
          ),
        }}
      />
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="worksheet-no-print font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <div className="worksheet-no-print">
          <PoemMeta title={poem.title} author={poem.author} dynasty={poem.dynasty} form={poem.form} />
        </div>
        <div className="flex items-center justify-end mb-2 worksheet-no-print">
          <ReadAloudButton text={`${poem.title}。${poem.author}。${poem.content}`} size="sm" variant="seal" />
        </div>
        <div className="card-paper p-5 sm:p-8 poem-print-area">
          <PoemViewer content={poem.content} />
        </div>
        {poem.appreciation && (
          <div className="worksheet-no-print">
            <AppreciationBlock text={poem.appreciation} />
          </div>
        )}
        <div className="worksheet-no-print flex flex-wrap items-center justify-center gap-3 mt-6">
          <PrintButton endpoint={`/api/poetry/${poem.id}/print`} loginRedirect={`/poetry/${poem.id}`} />
          <SaveAsWorksheetButton id={poem.id} title={poem.title} author={poem.author} content={poem.content} />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
