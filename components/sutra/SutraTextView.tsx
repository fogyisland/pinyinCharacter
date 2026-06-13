import type { SutraChunk } from '@/lib/sutra-types';

interface Props {
  chunk: SutraChunk;
}

export function SutraTextView({ chunk }: Props) {
  return (
    <div className="font-serif text-lg sm:text-xl text-ink leading-loose">
      {chunk.content.map((line, i) => (
        <p key={i} className="my-1.5">
          {line}
        </p>
      ))}
    </div>
  );
}
