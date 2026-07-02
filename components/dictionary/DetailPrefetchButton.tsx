'use client';

import { useState } from 'react';
import { prefetchTts } from '@/lib/tts-cache';
import { useToastStore } from '@/lib/toast-store';

interface Props {
  relatedChars: string[];
  cap?: number;
}

export function DetailPrefetchButton({ relatedChars, cap = 20 }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (relatedChars.length === 0) return;
    setLoading(true);
    const targets = relatedChars.slice(0, cap);
    let done = 0;
    for (const text of targets) {
      await prefetchTts('female', text).catch(() => {});
      done++;
    }
    setLoading(false);
    pushToast('success', `已预取 ${done} 个字的读音`);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || relatedChars.length === 0}
      className="rounded border border-ink/30 px-3 py-1 text-sm hover:bg-paper-deep disabled:opacity-50"
    >
      {loading ? '预取中…' : `预取同部首 (${relatedChars.length})`}
    </button>
  );
}