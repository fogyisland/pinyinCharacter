interface Props {
  pinyin: string;
  matched: boolean;
  onDragStart: (pinyin: string) => void;
}

export function PinyinToken({ pinyin, matched, onDragStart }: Props) {
  return (
    <div
      draggable={!matched}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', pinyin);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(pinyin);
      }}
      className={`flex h-12 cursor-grab select-none items-center justify-center rounded border-2 border-seal bg-paper px-3 text-lg font-mono text-ink shadow-sm active:cursor-grabbing ${
        matched ? 'pointer-events-none opacity-30' : 'hover:bg-seal/10'
      }`}
      aria-label={`拼音 ${pinyin}`}
      role="button"
    >
      {pinyin}
    </div>
  );
}
