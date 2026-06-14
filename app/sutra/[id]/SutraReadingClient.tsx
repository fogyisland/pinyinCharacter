'use client';

import { useSutraReading } from '@/lib/use-sutra-reading';
import { ReadingModePicker } from '@/components/common/ReadingModePicker';
import { SutraTextView } from '@/components/sutra/SutraTextView';
import type { SutraChunk } from '@/lib/sutra-types';

export function SutraReadingClient({ chunk }: { chunk: SutraChunk }) {
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