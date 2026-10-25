'use client';

import type { QuestCharPayload } from '@/lib/game-quest-types';
import { QuestSealStamp } from './QuestSealStamp';

/**
 * The end-of-level screen.
 *
 * A passed level gets the big seal and the 「下一关」 button; a level with
 * missed chars lists them and offers the remediation round
 * (「重挑错字」). Both branches carry the 「返回关卡地图」 button - at the end
 * of a tier the 「下一关」 re-opens the level just passed, so the passed
 * branch needs a way back too - and the 生字本 shortcut, because the misses
 * of a failed level are exactly what the wrong book is for.
 */
export interface QuestSummaryProps {
  tier: number;
  level: number;
  chars: QuestCharPayload[];
  /** The chars that were not mastered. */
  missed: string[];
  passed: boolean;
  onNext: () => void;
  /**
   * The remediation round (§5.6). It is **optional**: a second failure ends
   * the attempt, and the runner then hands over no callback at all - the
   * 「重挑错字」 button disappears.
   */
  onRemediate?: () => void;
  onExit: () => void;
}

export function QuestSummary({
  tier,
  level,
  chars,
  missed,
  passed,
  onNext,
  onRemediate,
  onExit,
}: QuestSummaryProps) {
  const missedSet = new Set(missed);
  const missedChars = chars.filter((char) => missedSet.has(char.char));

  return (
    <div className="text-center">
      <p className="text-sm text-ink-soft">
        HSK {tier} · 第 {level} 关
      </p>
      <p className="text-sm text-ink-soft">本关 {chars.length} 字</p>

      {passed ? (
        <>
          <h2 className="mt-2 text-2xl font-semibold text-ink">通关</h2>
          <div className="relative mx-auto my-6 h-24 w-24">
            <QuestSealStamp visible text="通" />
          </div>
          <button
            type="button"
            onClick={onNext}
            className="rounded border border-seal bg-seal px-5 py-2 text-paper-soft hover:opacity-90"
          >
            下一关
          </button>
          <button
            type="button"
            onClick={onExit}
            className="ml-3 rounded border border-ink/20 bg-paper px-5 py-2 text-ink-soft hover:bg-paper-deep"
          >
            返回关卡地图
          </button>
        </>
      ) : (
        <>
          <h2 className="mt-2 text-2xl font-semibold text-ink">还差几个字</h2>
          <ul className="mx-auto mt-4 flex max-w-lg flex-wrap justify-center gap-3">
            {missedChars.map((char) => (
              <li key={char.char} className="rounded border border-ink/20 bg-paper px-3 py-2">
                <span className="font-kai text-2xl text-ink">{char.char}</span>
                <span className="ml-2 text-sm text-ink-soft">
                  {char.plainPinyin} · 部首 {char.radical}
                </span>
              </li>
            ))}
          </ul>
          {onRemediate ? (
            <button
              type="button"
              onClick={onRemediate}
              className="rounded border border-seal bg-seal px-5 py-2 text-paper-soft hover:opacity-90"
            >
              重挑错字
            </button>
          ) : null}
          <button
            type="button"
            onClick={onExit}
            className={`rounded border border-ink/20 bg-paper px-5 py-2 text-ink-soft hover:bg-paper-deep ${
              onRemediate ? 'ml-3' : ''
            }`}
          >
            返回关卡地图
          </button>
        </>
      )}

      <p className="mt-5 text-sm">
        <a href="/game?tab=wrong" className="text-seal hover:underline">
          去生字本
        </a>
      </p>
    </div>
  );
}
