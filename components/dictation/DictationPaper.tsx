'use client';

import type { DictationItem } from '@/lib/dictation';
import type { CellStyle } from '@/lib/worksheet-types';
import { WorksheetCell } from '@/components/worksheet/WorksheetCell';

/**
 * One dictation paper: a numbered row per item, an optional pinyin line and
 * one practice cell per character.
 *
 * The paper has two modes and the SAME item list feeds both:
 *
 *   `blank`  — the sheet the student writes on. The cells are empty; the
 *              model character is the answer and printing it would give it
 *              away.
 *   `answer` — the sheet the teacher checks against. The cells carry the
 *              pale model character (trace styling: light gray fill, red
 *              outline) and the pinyin line is always printed — an answer
 *              page without the reading is not an answer page.
 *
 * Numbering runs continuously through the whole list (12 items = 1..12),
 * so the answer page and the blank sheet always agree on which row is
 * which item.
 */
interface Props {
  items: DictationItem[];
  mode: 'blank' | 'answer';
  /** Print the pinyin line on the blank sheet (the answer page always prints it). */
  showPinyin?: boolean;
  /** 田字格 or 米字格; the paper is the pen tool's square/cross styles. */
  grid?: 'square' | 'cross';
  /** Cell side in px. */
  cellSize?: number;
  /** Print the name/date line. */
  showNameLine?: boolean;
}

/** The cell style a paper cell is drawn with (pen square / pen cross). */
function cellStyle(grid: 'square' | 'cross'): CellStyle {
  return grid === 'cross' ? 'pen-cross' : 'pen-square';
}

/**
 * The dictation paper.
 *
 * @param props the items, the mode and the paper options.
 */
export function DictationPaper({
  items,
  mode,
  showPinyin = false,
  grid = 'square',
  cellSize = 56,
  showNameLine = true,
}: Props) {
  const isAnswer = mode === 'answer';
  // The blank sheet prints the reading only when the teacher asked for
  // hints; the answer page always does.
  const printPinyin = isAnswer || showPinyin;
  const style = cellStyle(grid);

  return (
    <div data-dictation-paper data-dictation-mode={mode} className="dictation-paper">
      {showNameLine ? (
        <div
          data-dictation-name-line
          className="mb-3 flex items-end justify-between gap-6 border-b border-ink/20 pb-2 text-xs text-ink-soft"
        >
          <span>姓名：____________</span>
          <span>日期：____________</span>
          <span>得分：__________</span>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p data-dictation-empty className="py-8 text-center text-sm text-ink-faint">
          还没有词条：先在上面选一批字或粘贴词表。
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div
              key={`${item.word}-${index}`}
              data-dictation-row
              className="dictation-row flex items-center gap-3"
            >
              <span
                data-dictation-number
                className="w-7 shrink-0 text-right text-sm tabular-nums text-ink-soft"
              >
                {index + 1}
              </span>
              <span className="-ml-2 shrink-0 text-sm text-ink-soft">.</span>
              <div className="flex flex-1 items-center gap-2">
                {printPinyin && item.pinyin !== '' ? (
                  <span
                    data-dictation-pinyin
                    className="w-24 shrink-0 text-xs text-ink-faint"
                    style={{ fontFamily: 'var(--font-han-serif)' }}
                  >
                    {item.pinyin}
                  </span>
                ) : null}
                <div className="flex flex-wrap items-center gap-1">
                  {item.chars.map((char, cellIndex) => (
                    <span
                      key={`${char}-${cellIndex}`}
                      data-dictation-cell
                      data-dictation-char={isAnswer ? char : ''}
                      className="dictation-cell inline-block"
                    >
                      <WorksheetCell
                        char={isAnswer ? char : ''}
                        style={style}
                        size={cellSize}
                        fontFamily="kai"
                      />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
