'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DictationItem } from '@/lib/dictation';
import { fetchClassDetail } from '@/lib/api-classes';
import { parseAssignmentLink } from '@/lib/dictation-url';
import { DictationPrep } from './DictationPrep';
import { DictationRunner } from './DictationRunner';

/**
 * The two faces of the dictation tool, sharing one item draft.
 *
 * The teacher prepares the batch in 出卷 and flips to 报听写 to run it —
 * the runner picks up exactly the items the form holds, so a class needs
 * no re-entry. The tab lives in the URL (?tab=runner) so a teacher can
 * bookmark the runner, like the game page's panels.
 *
 * ## The class link
 *
 * `?classId=&assignmentId=` means the learner arrived from a class
 * assignment. The words are NOT in the URL (see `lib/dictation-url.ts` for
 * why): the runner fetches the assignment from the class API, which
 * enforces membership, and fills the form with the teacher's words. The
 * batch stays ONE source of truth — the class's assignment — instead of a
 * copy in an address bar that can be truncated, edited, or shared outside
 * the class.
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

  const classIdRaw = params?.get('classId') ?? null;
  const assignmentIdRaw = params?.get('assignmentId') ?? null;
  const link = parseAssignmentLink(
    classIdRaw && assignmentIdRaw
      ? { classId: classIdRaw, assignmentId: assignmentIdRaw }
      : null,
  );
  // Primitive copies for the effect's dependency list: a `link` object is a
  // new reference on every render, so depending on it would re-run the
  // fetch on every keystroke.
  const linkClassId = link?.classId ?? null;
  const linkAssignmentId = link?.assignmentId ?? null;

  /** What the class lookup is doing. `null` = no link in the URL. */
  type LoadState =
    | { state: 'loading' }
    | { state: 'ok'; title: string }
    | { state: 'error'; message: string };
  const [load, setLoad] = useState<LoadState | null>(link ? { state: 'loading' } : null);

  /**
   * Fill the form from the class assignment.
   *
   * Runs once per link. The items are REPLACED rather than appended: the
   * learner opened this URL for one assignment, and a form that also holds
   * yesterday's draft would dictate words the teacher never assigned.
   */
  useEffect(() => {
    if (linkClassId === null || linkAssignmentId === null) return;
    let cancelled = false;
    void (async () => {
      const result = await fetchClassDetail(linkClassId);
      if (cancelled) return;
      if (!result.ok) {
        setLoad({ state: 'error', message: result.error.message });
        return;
      }
      const assignment = result.data.assignments.find((a) => a.id === linkAssignmentId);
      if (!assignment) {
        setLoad({ state: 'error', message: '这份作业不在该班级里，可能已被老师删除。' });
        return;
      }
      if (assignment.payload.kind !== 'dictation') {
        // A worksheet assignment opened in the dictation tool: say so
        // instead of silently showing an empty form.
        setLoad({ state: 'error', message: '这份作业是字帖，不是听写。' });
        return;
      }
      const fromAssignment: DictationItem[] = assignment.payload.items.map((item) => ({
        word: item.word,
        pinyin: item.pinyin,
        chars: Array.from(item.word),
      }));
      setItems(fromAssignment);
      setLoad({ state: 'ok', title: assignment.title });
    })();
    return () => {
      cancelled = true;
    };
  }, [linkClassId, linkAssignmentId]);

  function switchTab(next: 'prep' | 'runner'): void {
    const base = pathname ?? '/dictation';
    // The class link must survive the tab switch, or the next reload fills
    // an empty form.
    const query = new URLSearchParams();
    if (next === 'runner') query.set('tab', 'runner');
    if (classIdRaw && assignmentIdRaw) {
      query.set('classId', classIdRaw);
      query.set('assignmentId', assignmentIdRaw);
    }
    const nextUrl = query.toString() === '' ? base : `${base}?${query.toString()}`;
    router.replace(nextUrl);
  }

  return (
    <div className="space-y-4">
      {/* The class assignment this form was opened for. A learner needs to
          see WHICH assignment they are practising, and needs the failure
          case spelled out instead of a silent empty form. */}
      {load ? (
        <div data-testid="assignment-source" className="text-xs">
          {load.state === 'loading' ? (
            <span className="text-ink-faint">正在读取班级作业…</span>
          ) : load.state === 'ok' ? (
            <span className="text-ink-soft">
              来自班级作业「<span className="font-medium text-ink">{load.title}</span>」，{' '}
              {items.length} 条
            </span>
          ) : (
            <span role="alert" className="text-rose-700">
              {load.message} 下面可以从头自己选词。
            </span>
          )}
        </div>
      ) : null}

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
