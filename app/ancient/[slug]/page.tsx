import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { ClassicChunkPicker } from '@/components/classics/ClassicChunkPicker';
import { ClassicReader } from '@/components/classics/ClassicReader';
import { SutraAudioPlayer } from '@/components/sutra/SutraAudioPlayer';
import { getClassicBySlug } from '@/lib/classics';
import { buildMetadata } from '@/lib/seo/metadata';
import { buildBook, buildBreadcrumbList } from '@/lib/seo/jsonld';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ chunk?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const c = await getClassicBySlug(slug);
  if (!c) return { title: '古籍 · 字·韵' };
  const desc = `${c.title}${c.author ? ` - ${c.author}` : ''} (${c.era || ''}) 全文带拼音注音`;
  return await buildMetadata({
    title: `${c.title} (${c.era || '古代'}) 全文 拼音 | 字·韵`,
    description: desc,
    path: `/ancient/${slug}`,
    ogType: 'book',
  });
}

export default async function ClassicDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const book = await getClassicBySlug(slug);
  if (!book) notFound();

  const requested = Number(sp.chunk ?? '0');
  const activeIdx = Number.isInteger(requested) && requested >= 0 && requested < book.chunks.length ? requested : 0;
  const activeChunk = book.chunks[activeIdx]!;

  // Audio: feed every chapter (chunk) to SutraAudioPlayer. SutraAudioPlayer
  // tracks its own play position via /api/tts per chunk; the page-level
  // ?chunk=N URL still controls the visible chapter. They are intentionally
  // independent — switching chapter does not interrupt audio.
  const audioChunks = book.chunks.map((c, i) => ({
    id: i,
    title: c.label,
    text: c.content.join('\n'),
  }));

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBook({ title: book.title, author: book.author, era: book.era })) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(await buildBreadcrumbList([
          { name: '首页', url: '/' },
          { name: '古籍', url: '/ancient' },
          { name: book.title, url: `/ancient/${book.slug}` },
        ])) }}
      />
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="max-w-5xl mx-auto py-6 space-y-4">
          <div className="worksheet-no-print">
            <Link href="/ancient" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-seal">
              ← 返回古籍列表
            </Link>
          </div>
          <header className="worksheet-no-print">
            <h1 className="text-2xl font-bold text-ink font-kai">《{book.title}》</h1>
            <p className="text-sm text-ink-soft mt-1">
              {[book.author, book.era].filter(Boolean).join(' · ')}
              {book.chunks.length > 1 && ` · ${activeChunk.label}`}
            </p>
          </header>

          <div className="flex gap-6">
            <Suspense fallback={null}>
              <ClassicChunkPicker
                slug={book.slug}
                chunks={book.chunks.map(c => ({ id: c.id, label: c.label }))}
                activeId={activeChunk.id}
              />
            </Suspense>
            <div className="flex-1 min-w-0">
              <ClassicReader chunk={activeChunk} book={book} />
            </div>
          </div>
        </div>
      </PageContainer>
      <Footer />
      <SutraAudioPlayer chunks={audioChunks} playlistTitle={book.title} />
    </>
  );
}