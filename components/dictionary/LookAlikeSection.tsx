'use client';

import Link from 'next/link';
import type { LookAlikeView } from '@/lib/look-alike';
import { LookAlikeCard } from './LookAlikeCard';

/**
 * 形近字 — the look-alike section of the dictionary page.
 *
 * Purely presentational: the comparison is resolved on the SERVER
 * (`resolveLookAlikeView`) and handed in as props. The client must not
 * import `lib/look-alike-data`, which reads files — that is what broke the
 * build the last time a data reader reached a `'use client'` module.
 *
 * Renders nothing when there is no view: an empty heading reads as a bug.
 */
export interface LookAlikeSectionProps {
  view: LookAlikeView | null;
}

/**
 * The look-alike section.
 *
 * @param props the resolved view.
 */
export function LookAlikeSection({ view }: LookAlikeSectionProps) {
  if (!view) return null;

  return (
    <div>
      {view.featured ? (
        <LookAlikeCard
          comparison={view.featured.comparison}
          strokeCountA={view.featured.strokeCountA}
          strokeCountB={view.featured.strokeCountB}
        />
      ) : null}

      {view.rest.length > 0 ? (
        <section className="mt-4">
          <h3 className="mb-2 text-sm text-ink-soft">
            {view.featured ? '还有这些字容易混' : '形近字'} · {view.rest.length}
          </h3>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {view.rest.map((other) => (
              <li key={other}>
                <Link
                  href={`/dictionary/${encodeURIComponent(other)}`}
                  className="font-kai text-lg text-ink hover:text-seal"
                >
                  {other}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
