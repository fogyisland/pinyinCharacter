'use client';

import { useRouter } from 'next/navigation';
import { SutraChunkPicker } from '@/components/sutra/SutraChunkPicker';

interface Props {
  sutraId: number;
  /** Chapter id + label only — the picker never needs the chapter text. */
  chunks: Array<{ id: number; label: string }>;
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
