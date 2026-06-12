'use client';

import { useRouter } from 'next/navigation';
import { SutraChunkPicker } from '@/components/sutra/SutraChunkPicker';
import type { SutraChunk } from '@/lib/sutra-types';

interface Props {
  sutraId: number;
  chunks: SutraChunk[];
  activeId: number;
}

export function SutraChunkPickerClient({ sutraId, chunks, activeId }: Props) {
  const router = useRouter();
  return (
    <SutraChunkPicker
      chunks={chunks}
      activeId={activeId}
      onChange={(id) => router.push(`/sutra/${sutraId}?chunk=${id}`)}
    />
  );
}
