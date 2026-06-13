import { WorksheetCell } from '@/components/worksheet/WorksheetCell';

interface Props {
  content: string[];
  pinyin: string[][];
}

export function PoemWorksheet({ content, pinyin }: Props) {
  return (
    <div className="worksheet-grid space-y-6 print:space-y-4">
      {content.map((line, lineIdx) => (
        <div key={lineIdx} className="poem-line flex flex-wrap items-end gap-3 justify-center">
          {Array.from(line).map((char, charIdx) => (
            <div key={charIdx} className="poem-char flex flex-col items-center">
              <WorksheetCell char={char} style="brush" size={70} />
              {pinyin[lineIdx]?.[charIdx] && (
                <span className="text-[10px] text-ink-faint mt-1 leading-none">
                  {pinyin[lineIdx][charIdx]}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
