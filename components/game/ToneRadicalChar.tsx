interface Props {
  char: string;
  pinyin: string;
  matchedTone: 1 | 2 | 3 | 4 | 5 | null;
  matchedRadical: string | null;
  onDrop: (kind: 'tone' | 'radical', payload: string) => void;
}

function DropSlot({
  kind,
  label,
  matched,
  onDrop,
}: {
  kind: 'tone' | 'radical';
  label: string;
  matched: string | null;
  onDrop: (kind: 'tone' | 'radical', payload: string) => void;
}) {
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
      className={`flex h-10 w-14 items-center justify-center rounded border-2 border-dashed text-lg font-kai ${
        matched ? 'border-seal bg-seal/10 text-seal' : 'border-ink/20 text-ink-faint'
      }`}
      aria-label={label}
    >
      {matched ?? '?'}
    </div>
  );
}

export function ToneRadicalChar({ char, pinyin, matchedTone, matchedRadical, onDrop }: Props) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="font-kai text-5xl text-ink">{char}</div>
      <div className="font-mono text-sm text-ink-faint">{pinyin}</div>
      <div className="flex gap-2">
        <DropSlot kind="tone" label="声调槽" matched={matchedTone ? String(matchedTone) : null} onDrop={onDrop} />
        <DropSlot kind="radical" label="部首槽" matched={matchedRadical} onDrop={onDrop} />
      </div>
    </div>
  );
}
