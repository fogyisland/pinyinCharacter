import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getWorksheet } from '@/lib/worksheet';
import { paperSizeLabel, fontFamilyLabel, cellStyleLabel } from '@/lib/worksheet-types';
import { WorksheetPreview } from '@/components/worksheet/WorksheetPreview';
import { DeleteWorksheetButton } from '@/components/worksheet/DeleteWorksheetButton';
import { PrintButton } from '@/components/common/PrintButton';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WorksheetDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/?auth=login&next=/worksheet/${id}`);
  const wid = Number(id);
  if (!Number.isInteger(wid)) notFound();
  const ws = await getWorksheet(wid);
  if (!ws) notFound();
  if (ws.userId !== user.id) notFound();
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <div className="worksheet-no-print mb-4 flex items-end justify-between gap-3">
          <SectionTitle>{ws.title}</SectionTitle>
          <div className="flex shrink-0 gap-2">
            <PrintButton endpoint={`/api/worksheets/${ws.id}/print`} gate="multi_page" />
            <DeleteWorksheetButton id={ws.id} />
          </div>
        </div>
        <p className="worksheet-no-print mb-4 text-sm text-ink-faint">
          {paperSizeLabel(ws.paperSize)} · {fontFamilyLabel(ws.fontFamily)} · {ws.content.length} 字 ·{' '}
          {cellStyleLabel(ws.cellStyle)} ·{' '}
          {new Date(ws.createdAt).toLocaleString()}
        </p>
        <div className="card-paper p-5">
          <WorksheetPreview
            title={undefined}
            content={ws.content}
            cellStyle={ws.cellStyle}
            paperSize={ws.paperSize}
            fontFamily={ws.fontFamily}
            showHeader={false}
          />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
