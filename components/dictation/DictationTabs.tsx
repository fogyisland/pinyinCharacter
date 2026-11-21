'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DictationItem } from '@/lib/dictation';
import { DictationPrep } from './DictationPrep';
import { DictationRunner } from './DictationRunner';

/**
 * The two faces of the dictation tool, sharing one item draft.
 *
 * The teacher prepares the batch in 出卷 and flips to 报听写 to run it —
 * the runner picks up exactly the items the form holds, so a class needs
 * no re-entry. The tab lives in the URL (?tab=runner) so a teacher can
 * bookmark the runner, like the game page's panels.
 */

/** The countdown pace of the runner; null = the teacher drives manually. */
type IntervalSec = 5 | 8 | 12 | null;

const INTERVALS: Array<[IntervalSec, string]> = [
  [5, '5 秒'],
  [8, '8 秒'],
  [12, '12 秒'],
  [null, '手动'],
];

/**
 * The dictation tabs.
 */
export function DictationTabs() {
  const [items, setItems] = useState<DictationItem[]>([]);
  const [intervalSec, setIntervalSec] = useState<IntervalSec>(8);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params?.get('tab') === 'runner' ? 'runner' : 'prep';

  function switchTab(next: 'prep' | 'runner'): void {
    const url = next === 'runner' ? `${pathname ?? '/dictation'}?tab=runner` : (pathname ?? '/dictation');
    router.replace(url);
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="听写练习" className="flex gap-2">
        {(
          [
            ['prep', '出卷'],
            ['runner', '报听写'],
          ] as Array<['prep' | 'runner', string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => switchTab(key)}
            className={`rounded px-3 py-1 text-sm ${
              tab === key ? 'border-b-2 border-seal font-medium text-seal' : 'text-ink-faint'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'prep' ? (
        <DictationPrep items={items} onChange={setItems} />
      ) : (
        <div className="space-y-3">
          <div role="group" aria-label="翻条节奏" className="flex items-center gap-2 text-sm">
            <span className="text-ink-soft">节奏：</span>
            {INTERVALS.map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setIntervalSec(value)}
                className={`rounded border px-2 py-1 text-xs ${
                  intervalSec === value
                    ? 'border-seal bg-seal/10 text-seal'
                    : 'border-ink/20 text-ink-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <DictationRunner items={items} intervalSec={intervalSec} />
        </div>
      )}
    </div>
  );
}
