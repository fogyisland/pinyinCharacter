'use client';

import Link from 'next/link';
import type { Comparison } from '@/lib/look-alike';

/**
 * 形近字 — one comparison, shown as a card.
 *
 * The panel answers the question a learner actually has: 「这两个字哪里不
 * 一样？」 So it shows the two characters side by side, the stroke that
 * differs, and how much of the rest coincides — printed as a percentage,
 * because 「相似度 97%」 is a sentence a learner understands while 「mean
 * 0.035」 is not.
 *
 * It also says plainly when a pair is similar but NOT a confusion pair: the
 * page can compare any two characters a learner picks, and "these look alike
 * but you would not confuse them" is the more useful answer.
 */
export interface LookAlikeCardProps {
  comparison: Comparison;
  strokeCountA: number;
  strokeCountB: number;
}

/**
 * The comparison card.
 *
 * @param props the comparison and the two stroke counts.
 */
export function LookAlikeCard({ comparison, strokeCountA, strokeCountB }: LookAlikeCardProps) {
  const similarity = Math.round((1 - Math.min(1, comparison.mean)) * 100);
  const showsDiff = comparison.diffStrokeA >= 0 && comparison.isLookAlike;

  return (
    <section data-look-alike className="mt-6 rounded border border-ink/15 bg-paper-soft p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm text-ink-soft">形近字对比</h3>
        {comparison.isLookAlike ? (
          <span className="rounded bg-seal/10 px-2 py-0.5 text-xs text-seal">容易混淆</span>
        ) : (
          <span className="rounded bg-ink/5 px-2 py-0.5 text-xs text-ink-faint">不是形近字</span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-center gap-6">
        <div className="text-center">
          <span data-testid="look-alike-a" className="font-kai text-5xl leading-none text-ink">
            {comparison.a}
          </span>
          <p className="mt-1 text-xs text-ink-faint">{strokeCountA} 画</p>
        </div>
        <span className="text-ink-faint">vs</span>
        <div className="text-center">
          <span data-testid="look-alike-b" className="font-kai text-5xl leading-none text-ink">
            {comparison.b}
          </span>
          <p className="mt-1 text-xs text-ink-faint">{strokeCountB} 画</p>
        </div>
      </div>

      <div className="mt-4 space-y-1 text-sm">
        <p data-testid="similarity" className="text-ink-soft">
          相似度 {similarity}% —— 大部分笔画重合。
        </p>
        {showsDiff ? (
          <p data-testid="diff-stroke" className="text-seal">
            不同的笔画：第 {comparison.diffStrokeA + 1} 笔。
          </p>
        ) : (
          <p className="text-ink-soft">
            {comparison.isLookAlike
              ? '笔画数不同，差一笔。'
              : '笔画走向差异较大，日常书写不会混淆 —— 但仍然值得分别练一练。'}
          </p>
        )}
        {comparison.isLookAlike ? (
          <p className="text-xs text-ink-faint">
            写的时候先数笔画、再看那一笔的位置，这是区分形近字的关键。
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <Link
          href={`/dictionary/${encodeURIComponent(comparison.b)}`}
          className="text-seal hover:underline"
        >
          看「{comparison.b}」的字典 →
        </Link>
        <Link
          href={`/worksheet?prefill=${encodeURIComponent(`${comparison.a}${comparison.b}`)}`}
          className="text-seal hover:underline"
        >
          对比练这两个字 →
        </Link>
      </div>
    </section>
  );
}
