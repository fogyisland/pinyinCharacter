interface Props {
  radical: string;
  matched: boolean;
  onDragStart: (radical: string) => void;
}

export function RadicalToken({ radical, matched, onDragStart }: Props) {
  return (
    <div
      draggable={!matched}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', radical);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(radical);
      }}
      className={`flex h-12 min-w-12 cursor-grab select-none items-center justify-center rounded border-2 border-seal bg-paper px-3 text-2xl font-kai text-ink shadow-sm active:cursor-grabbing ${
        matched ? 'pointer-events-none opacity-30' : 'hover:bg-seal/10'
      }`}
      aria-label={`部首 ${radical}`}
      role="button"
    >
      {radical}
    </div>
  );
}
