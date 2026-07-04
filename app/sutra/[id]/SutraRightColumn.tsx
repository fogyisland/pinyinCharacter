'use client';

import { useState } from 'react';
import type { SutraChunk } from '@/lib/sutra-types';
import { useSutraReading } from '@/lib/use-sutra-reading';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import { PrintButton } from '@/components/common/PrintButton';
import { SaveAsWorksheetButton } from './SaveAsWorksheetButton';
import { SutraReadingClient } from './SutraReadingClient';
import { SutraCopyView } from '@/components/sutra/SutraCopyView';

interface Props {
  sutraId: number;
  sutraSlug: string;
  sutraTitle: string;
  chunk: SutraChunk;
  userId: number | null;
  isLoggedIn: boolean;
}

export function SutraRightColumn({ sutraId, sutraSlug, sutraTitle, chunk, userId }: Props) {
  const [copyMode, setCopyMode] = useState(false);
  const [reading] = useSutraReading();
  return (
    <>
      <div className="flex items-center justify-between mb-2 worksheet-no-print">
        <button
          type="button"
          onClick={() => setCopyMode(v => !v)}
          className={
            'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
            (copyMode
              ? 'border-seal bg-seal text-white'
              : 'border-ink/20 text-ink-soft hover:bg-ink/5')
          }
          aria-pressed={copyMode}
        >
          {copyMode ? '退出抄经' : '进入抄经'}
        </button>
        {!copyMode && <ReadAloudButton text={chunk.content.join('\n')} size="sm" variant="seal" />}
      </div>
      <div className="card-paper p-5 sm:p-8 sutra-print-area">
        {copyMode ? (
          <SutraCopyView
            key={chunk.id}
            chunk={chunk}
            sutraId={sutraId}
            sutraSlug={sutraSlug}
            userId={userId}
            reading={reading}
            onExit={() => setCopyMode(false)}
          />
        ) : (
          <SutraReadingClient chunk={chunk} />
        )}
      </div>
      {!copyMode && (
        <div className="worksheet-no-print flex flex-wrap items-center justify-center gap-3 mt-6">
          <PrintButton endpoint={`/api/sutra/${sutraSlug}/print`} sourceId={`${sutraSlug}#${chunk.id}`} />
          <SaveAsWorksheetButton id={sutraId} title={sutraTitle} chunk={chunk} />
        </div>
      )}
    </>
  );
}
