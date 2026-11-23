'use client';

import { Suspense } from 'react';
import { DictationTabs } from '@/components/dictation/DictationTabs';

/**
 * The dictation tool's client shell.
 *
 * Split out of `page.tsx` for one reason: a page that exports `metadata` (or
 * `generateMetadata`) cannot itself carry `'use client'` — Next.js reads
 * metadata on the server. The route's title and canonical link are worth more
 * than keeping the markup in one file, so the client half lives here and the
 * page stays a server component.
 */
export function DictationClient() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="worksheet-no-print mb-4">
        <h1 className="text-xl font-bold">听写练习</h1>
        <p className="mt-1 text-sm text-ink-soft">
          选词条 → 生成听写卷与答案页 → 打印上课。答题卷留空给学生写，答案页带浅灰范字。
        </p>
      </div>
      {/* useSearchParams needs a Suspense boundary on a static route. */}
      <Suspense fallback={null}>
        <DictationTabs />
      </Suspense>
    </main>
  );
}
