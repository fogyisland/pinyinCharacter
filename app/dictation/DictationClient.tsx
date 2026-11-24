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
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12 print:p-0 [&_button]:min-h-11 [&_button]:cursor-pointer [&_button:disabled]:cursor-default">
      <div className="worksheet-no-print mb-6 sm:mb-8">
        <h1 className="font-kai text-4xl font-semibold tracking-wide sm:text-5xl">听写练习</h1>
        <p className="mt-3 max-w-prose leading-7 text-ink-soft">
          为这次听写选一组词，打印练习纸，或打开「报听写」听读音、写汉字。
        </p>
      </div>
      {/* useSearchParams needs a Suspense boundary on a static route. */}
      <Suspense fallback={null}>
        <DictationTabs />
      </Suspense>
    </main>
  );
}
