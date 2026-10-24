import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSutraChunk, getSutraMeta } from '@/lib/sutras';
import { getCurrentUser } from '@/lib/auth';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { SutraMeta } from '@/components/sutra/SutraMeta';
import { SutraAudioPlayer } from '@/components/sutra/SutraAudioPlayer';
import { SutraChunkPickerClient } from './SutraChunkPickerClient';
import { SutraRightColumn } from './SutraRightColumn';
import { getSutraBackLink } from './back-link';
import { buildBook, buildBreadcrumbList } from '@/lib/seo/jsonld';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chunk?: string; from?: string }>;
}

export default async function SutraDetailPage({ params, searchParams }: Props) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const meta = await getSutraMeta(id);
  if (!meta) notFound();
  const user = await getCurrentUser();

  const requestedChunk = Number(sp.chunk ?? '0');
  const activeChunkId =
    Number.isInteger(requestedChunk) && requestedChunk >= 0 && requestedChunk < meta.chunkCount
      ? requestedChunk
      : 0;
  // Only the chapter on screen is rendered. The other chapters used to be
  // serialized into the RSC payload (and into the audio playlist) even
  // though the page never displays them.
  const activeChunk = await getSutraChunk(id, activeChunkId);
  if (!activeChunk) notFound();
  const backLink = getSutraBackLink(sp.from);

  // Audio: the player pulls a chapter's text on demand (see textUrlTemplate)
  // and keeps its own play position via /api/tts. The page-level ?chunk=N
  // URL still controls the visible chapter — the two are intentionally
  // independent, switching chapter does not interrupt audio.
  const audioChunks = meta.chunks.map((c) => ({ id: c.id, title: c.label }));

  // JSON-LD: Book + BreadcrumbList. SutraDetail has no translator/era fields
  // (only id/title/slug/chunks), so we pass null for author and omit era.
  const bookJsonLd = buildBook({ title: meta.title, author: null, era: null });
  const breadcrumbJsonLd = await buildBreadcrumbList([
    { name: '首页', url: '/' },
    { name: meta.title, url: `/sutra/${meta.id}` },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(bookJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="worksheet-no-print font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">
          字 · 韵
        </div>
        <div className="worksheet-no-print mb-2">
          <Link
            href={backLink.href}
            className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-seal transition-colors"
          >
            <span aria-hidden="true">←</span> {backLink.label}
          </Link>
        </div>
        <div className="worksheet-no-print">
          <SutraMeta
            title={meta.title}
            chunkLabel={meta.chunkCount > 1 ? activeChunk.label : null}
          />
        </div>
        <div className="flex gap-6">
          <Suspense fallback={null}>
            <SutraChunkPickerClient
              sutraId={meta.id}
              chunks={meta.chunks}
              activeId={activeChunkId}
            />
          </Suspense>
          <div className="flex-1">
            <SutraRightColumn
              sutraId={meta.id}
              sutraSlug={meta.slug}
              sutraTitle={meta.title}
              chunk={activeChunk}
              userId={user?.id ?? null}
              isLoggedIn={!!user}
            />
          </div>
        </div>
      </PageContainer>
      <Footer />
      <SutraAudioPlayer
        chunks={audioChunks}
        playlistTitle={meta.title}
        textUrlTemplate={`/api/sutras/${meta.id}/chunk/{index}`}
      />
    </>
  );
}
