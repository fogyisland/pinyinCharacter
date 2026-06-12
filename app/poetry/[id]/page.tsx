import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getPoem } from '@/lib/poetry';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { PoemMeta } from '@/components/poetry/PoemMeta';
import { PoemWorksheet } from '@/components/poetry/PoemWorksheet';
import { AppreciationBlock } from '@/components/poetry/AppreciationBlock';
import { SaveAsWorksheetButton } from './SaveAsWorksheetButton';
import { PrintButton } from './PrintButton';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PoemDetailPage({ params }: Props) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const poem = await getPoem(id);
  if (!poem) notFound();

  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="worksheet-no-print font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <div className="worksheet-no-print">
          <PoemMeta title={poem.title} author={poem.author} dynasty={poem.dynasty} form={poem.form} />
        </div>
        <div className="card-paper p-5 sm:p-8">
          <PoemWorksheet content={poem.content} pinyin={poem.pinyin} />
        </div>
        {poem.appreciation && (
          <div className="worksheet-no-print">
            <AppreciationBlock text={poem.appreciation} />
          </div>
        )}
        <div className="worksheet-no-print flex flex-wrap items-center justify-center gap-3 mt-6">
          <PrintButton />
          <SaveAsWorksheetButton id={poem.id} title={poem.title} author={poem.author} content={poem.content} />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
