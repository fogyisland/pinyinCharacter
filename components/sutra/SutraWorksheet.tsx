'use client';

import { WorksheetCell } from '@/components/worksheet/WorksheetCell';
import type { SutraChunk } from '@/lib/sutra-types';
import { useAppStore } from '@/lib/store';

interface Props {
  chunk: SutraChunk;
}

export function SutraWorksheet({ chunk }: Props) {
  const showPinyin = useAppStore((s) => s.showPinyin);
  return (
    <div className="worksheet-grid space-y-5 print:space-y-3 max-w-3xl mx-auto">
      {chunk.content.map((line, lineIdx) => (
        <div key={lineIdx} className="sutra-line flex flex-wrap items-end gap-2 justify-center">
          {Array.from(line).map((char, charIdx) => (
            <div key={charIdx} className="sutra-char flex flex-col items-center">
              <WorksheetCell char={char} style="brush-cross" size={60} />
              {showPinyin && chunk.pinyin[lineIdx]?.[charIdx] && (
                <span className="text-[10px] text-ink-faint mt-0.5 leading-none">
                  {chunk.pinyin[lineIdx][charIdx]}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
