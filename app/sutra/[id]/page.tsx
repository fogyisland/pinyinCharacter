import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getSutra } from '@/lib/sutras';
import { getCurrentUser } from '@/lib/auth';
import type { SutraChunk } from '@/lib/sutra-types';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { SutraMeta } from '@/components/sutra/SutraMeta';
import { SutraChunkPickerClient } from './SutraChunkPickerClient';
import { SutraRightColumn } from './SutraRightColumn';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chunk?: string }>;
}

export default async function SutraDetailPage({ params, searchParams }: Props) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sutra = await getSutra(id);
  if (!sutra) notFound();
  const user = await getCurrentUser();

  const requestedChunk = Number(sp.chunk ?? '0');
  const activeChunkId =
    Number.isInteger(requestedChunk) && requestedChunk >= 0 && requestedChunk < sutra.chunks.length
      ? requestedChunk
      : 0;
  const activeChunk = sutra.chunks[activeChunkId]!;

  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="worksheet-no-print font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <div className="worksheet-no-print">
          <SutraMeta title={sutra.title} chunkLabel={sutra.chunks.length > 1 ? activeChunk.label : null} />
        </div>
        <div className="flex gap-6">
          <Suspense fallback={null}>
            <SutraChunkPickerClient sutraId={sutra.id} chunks={sutra.chunks as SutraChunk[]} activeId={activeChunkId} />
          </Suspense>
          <div className="flex-1">
            <SutraRightColumn
              sutraId={sutra.id}
              sutraSlug={sutra.slug}
              sutraTitle={sutra.title}
              chunk={activeChunk}
              userId={user?.id ?? null}
              isLoggedIn={!!user}
            />
          </div>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
