import type { SutraChunk } from '@/lib/sutra-types';
import type { SutraReading } from '@/lib/sutra-reading';

interface Props {
  chunk: SutraChunk;
  reading?: SutraReading;
}

const WRITING_MODE: Record<SutraReading, string> = {
  'horizontal': 'horizontal-tb',
  'vertical-rtl': 'vertical-rl',
  'vertical-ltr': 'vertical-lr',
};

export function SutraTextView({ chunk, reading = 'horizontal' }: Props) {
  const isVertical = reading !== 'horizontal';
  return (
    <div
      className={`font-serif text-lg sm:text-xl text-ink leading-loose ${
        isVertical ? 'h-[28rem] overflow-x-auto' : ''
      }`}
      style={isVertical ? { writingMode: WRITING_MODE[reading] as 'vertical-rl' | 'vertical-lr' } : undefined}
    >
      {chunk.content.map((line, i) => (
        <p key={i} className={isVertical ? 'mx-3 inline-block' : 'my-1.5'}>
          {line}
        </p>
      ))}
    </div>
  );
}