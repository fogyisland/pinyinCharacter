'use client';

import { useSutraReading } from '@/lib/use-sutra-reading';
import { ReadingModePicker } from '@/components/common/ReadingModePicker';
import { SutraTextView } from '@/components/sutra/SutraTextView';
import type { SutraChunkText } from '@/lib/sutra-types';

export function SutraReadingClient({ chunk }: { chunk: SutraChunkText }) {
  const [reading, setReading] = useSutraReading();
  return (
    <>
      <div className="flex items-center justify-end mb-3 worksheet-no-print">
        <ReadingModePicker value={reading} onChange={setReading} />
      </div>
      <SutraTextView chunk={chunk} reading={reading} />
    </>
  );
}
