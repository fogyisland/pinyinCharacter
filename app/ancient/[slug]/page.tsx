import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { ClassicChunkPicker } from '@/components/classics/ClassicChunkPicker';
import { ClassicReader } from '@/components/classics/ClassicReader';
import { SutraAudioPlayer } from '@/components/sutra/SutraAudioPlayer';
import { PrintButton } from '@/components/common/PrintButton';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import { SaveAsWorksheetButton } from './SaveAsWorksheetButton';
import {
  getClassicChunkBySlug,
  getClassicChunkMetaBySlug,
  getClassicMetaBySlug,
} from '@/lib/classics';
import { buildMetadata } from '@/lib/seo/metadata';
import { buildBook, buildBreadcrumbList, serializeJsonLd } from '@/lib/seo/jsonld';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ chunk?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  // Metadata comes from the manifest, so building a page title never reads
  // the (up to 8 MB) book file.
  const meta = await getClassicMetaBySlug(slug);
  if (!meta) return { title: '古籍 · 字·韵' };
  const desc = `${meta.title}${meta.author ? ` - ${meta.author}` : ''} (${meta.era || ''}) 全文带拼音注音`;
  return await buildMetadata({
    title: `${meta.title} (${meta.era || '古代'}) 全文 拼音 | 字·韵`,
    description: desc,
    path: `/ancient/${slug}`,
    ogType: 'book',
  });
}

export default async function ClassicDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const meta = await getClassicMetaBySlug(slug);
  if (!meta) notFound();
  const chunkMeta = await getClassicChunkMetaBySlug(slug);
  if (!chunkMeta) notFound();

  const requested = Number(sp.chunk ?? '0');
  const activeIdx =
    Number.isInteger(requested) && requested >= 0 && requested < chunkMeta.length ? requested : 0;
  // Only the chapter on screen is rendered: the whole book used to be
  // serialized into the RSC payload (8 MB for the largest books).
  const activeChunk = await getClassicChunkBySlug(slug, activeIdx);
  if (!activeChunk) notFound();

  // Audio: the player pulls a chapter's text on demand (see textUrlTemplate),
  // so the page ships chapter labels only. It tracks its own play position
  // via /api/tts per chapter; the page-level ?chunk=N URL still controls the
  // visible chapter. They are intentionally independent — switching chapter
  // does not interrupt audio.
  const audioChunks = chunkMeta.map((c, i) => ({ id: i, title: c.label }));

  return (
    <>
      <script
        type="application/ld+json"

        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            buildBook({ title: meta.title, author: meta.author, era: meta.era }),
          ),
        }}
      />
      <script
        type="application/ld+json"

        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            await buildBreadcrumbList([
              { name: '首页', url: '/' },
              { name: '古籍', url: '/ancient' },
              { name: meta.title, url: `/ancient/${meta.slug}` },
            ]),
          ),
        }}
      />
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="max-w-5xl mx-auto py-6 space-y-4">
          <div className="worksheet-no-print">
            <Link
              href="/ancient"
              className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-seal"
            >
              ← 返回古籍列表
            </Link>
          </div>
          <header className="worksheet-no-print publication-heading">
            <h1>《{meta.title}》</h1>
            <p className="text-sm text-ink-soft mt-1">
              {[meta.author, meta.era].filter(Boolean).join(' · ')}
              {chunkMeta.length > 1 && ` · ${activeChunk.label}`}
            </p>
          </header>

          <div className="flex flex-col gap-6 md:flex-row md:gap-10">
            <Suspense fallback={null}>
              <ClassicChunkPicker
                slug={meta.slug}
                chunks={chunkMeta}
                activeId={activeChunk.id}
              />
            </Suspense>
            <div className="flex-1 min-w-0">
              {/* The printable container. `classic-print-area` must stay in
                  all three lists of the @media print whitelist in
                  app/globals.css — a container that is not whitelisted
                  prints a BLANK page. That regression happened for the
                  poem and the sutra on 2026-07-04. */}
              <div className="classic-print-area">
                <ClassicReader
                  chunk={activeChunk}
                  book={{
                    slug: meta.slug,
                    title: meta.title,
                    chunkCount: chunkMeta.length,
                  }}
                />
              </div>
            </div>
          </div>

          {/* The action row: the same three actions the poems and the
              sutras offer. The classics are the longest text on the site
              and the most likely material for copying practice, so they
              need them the most. */}
          <div className="worksheet-no-print flex flex-wrap items-center justify-center gap-3 mt-6">
            <ReadAloudButton
              text={activeChunk.content.join('\n')}
              size="sm"
              variant="seal"
            />
            <PrintButton
              endpoint={`/api/classics/${meta.slug}/print`}
              sourceId={`${meta.slug}#${activeChunk.id}`}
              loginRedirect={`/ancient/${meta.slug}`}
            />
            <SaveAsWorksheetButton
              title={meta.title}
              chapterLabel={activeChunk.label}
              content={activeChunk.content}
            />
          </div>
        </div>
      </PageContainer>
      <Footer />
      <SutraAudioPlayer
        chunks={audioChunks}
        playlistTitle={meta.title}
        textUrlTemplate={`/api/classics/${meta.slug}/chunk/{index}`}
      />
    </>
  );
}
