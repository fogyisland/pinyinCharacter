interface Props {
  tone: 1 | 2 | 3 | 4 | 5;
  matched: boolean;
  onDragStart: (tone: 1 | 2 | 3 | 4 | 5) => void;
}

export function ToneToken({ tone, matched, onDragStart }: Props) {
  return (
    <div
      draggable={!matched}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(tone));
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(tone);
      }}
      className={`flex h-12 w-12 cursor-grab select-none items-center justify-center rounded-full border-2 border-seal bg-paper text-2xl font-kai text-seal shadow-sm active:cursor-grabbing ${
        matched ? 'pointer-events-none opacity-30' : 'hover:bg-seal/10'
      }`}
      aria-label={`声调 ${tone}`}
      role="button"
    >
      {tone}
    </div>
  );
}
