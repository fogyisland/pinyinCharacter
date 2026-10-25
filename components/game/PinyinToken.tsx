import type { DragEvent } from 'react';

interface Props {
  pinyin: string;
  matched: boolean;
  onDragStart: (pinyin: string) => void;
  /**
   * Index of this token inside the round's token bank. When it is present the
   * token is draggable and its drag payload is this INDEX — the client
   * resolves every drop through `tokenValues[index]`, so the payload format
   * has to match the other two tokens. The pinyin mode's values are unique,
   * so the index changes nothing for it. When it is absent the token renders
   * as a static chip: it shows the value but cannot be dragged.
   */
  tokenIndex?: number;
}

export function PinyinToken({ pinyin, matched, onDragStart, tokenIndex }: Props) {
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (tokenIndex === undefined) return;
    e.dataTransfer.setData('text/plain', String(tokenIndex));
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(pinyin);
  };

  const isDraggable = tokenIndex !== undefined && !matched;

  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      className={`flex h-12 ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''} select-none items-center justify-center rounded border-2 border-seal bg-paper px-3 text-lg font-mono text-ink shadow-sm ${
        matched ? 'pointer-events-none opacity-30' : 'hover:bg-seal/10'
      }`}
      aria-label={`拼音 ${pinyin}`}
      role="button"
    >
      {pinyin}
    </div>
  );
}
