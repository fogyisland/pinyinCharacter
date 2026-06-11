import { Suspense } from 'react';
import { listChars, getDailyChar } from '@/lib/rare-chars';
import { RareCharCard } from '@/components/rare/RareCharCard';
import { RareCharSearch } from '@/components/rare/RareCharSearch';
import { RareCharPagination } from '@/components/rare/RareCharPagination';
import { DailyCharBanner } from '@/components/rare/DailyCharBanner';
import { EmptyState } from '@/components/common/EmptyState';

export const dynamic = 'force-dynamic';

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function RareCharsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = sp.q ?? '';
  const page = sp.page ? Number(sp.page) : 1;

  const [listResult, daily] = await Promise.all([
    listChars({ q, page }),
    getDailyChar(todayLocal()).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <h1 className="text-2xl font-bold">罕见字库</h1>

      {daily && (
        <DailyCharBanner
          char={daily.char}
          pinyin={daily.pinyin}
          meaning={daily.meaning}
          date={daily.date}
        />
      )}

      <Suspense>
        <RareCharSearch />
      </Suspense>

      {listResult.chars.length === 0 ? (
        <EmptyState
          title="没有匹配的字"
          description={q ? `没有匹配 "${q}" 的字。` : '字库为空。'}
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-8">
            {listResult.chars.map((c) => (
              <RareCharCard key={c.char} char={c.char} pinyin={c.pinyin} meaning={c.meaning} />
            ))}
          </div>
          <RareCharPagination
            page={listResult.page}
            total={listResult.total}
            pageSize={listResult.pageSize}
            basePath="/rare-chars"
            q={q}
          />
        </>
      )}
    </div>
  );
}
