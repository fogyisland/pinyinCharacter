import type { Tone } from '@/lib/pinyin-tone';

type Kind = 'tone' | 'radical' | 'pinyin';

interface Props {
  char: string;
  pinyin: string;
  /** Which slot to render, plus the matched value (null = empty). */
  slotKind: Kind;
  matched: string | null;
  onDrop: (kind: Kind, payload: string) => void;
}

function DropSlot({
  kind,
  label,
  matched,
  onDrop,
}: {
  kind: Kind;
  label: string;
  matched: string | null;
  onDrop: (kind: Kind, payload: string) => void;
}) {
  // For tone mode the slot is a small square; for pinyin/radical it's
  // wider to fit the string.
  const isTone = kind === 'tone';
  return (
    <div
      data-slot={kind}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(kind, e.dataTransfer.getData('text/plain'));
      }}
      className={`flex h-10 ${isTone ? 'w-14' : 'min-w-20 px-2'} items-center justify-center rounded border-2 border-dashed text-lg ${
        isTone ? 'font-kai' : 'font-mono'
      } ${matched ? 'border-seal bg-seal/10 text-seal' : 'border-ink/20 text-ink-faint'}`}
      aria-label={label}
    >
      {matched ?? '?'}
    </div>
  );
}

export function ToneRadicalChar({ char, pinyin, slotKind, matched, onDrop }: Props) {
  // Pinyin is shown above the slot in tone/radical mode (for context) and
  // hidden in pinyin mode (the slot itself holds the pinyin once matched).
  const showPinyin = slotKind !== 'pinyin';
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="font-kai text-5xl text-ink">{char}</div>
      {showPinyin && <div className="font-mono text-sm text-ink-faint">{pinyin}</div>}
      <DropSlot
        kind={slotKind}
        label={
          slotKind === 'tone' ? '声调槽' : slotKind === 'radical' ? '部首槽' : '拼音槽'
        }
        matched={matched}
        onDrop={onDrop}
      />
    </div>
  );
}
