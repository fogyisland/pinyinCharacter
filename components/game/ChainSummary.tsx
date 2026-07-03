'use client';

import { ReadAloudButton } from '@/components/ReadAloudButton';
import { speak, stopSpeaking } from '@/lib/tts';
import type { CharInfo } from '@/lib/chain-types';

export function ChainSummary({
  chain,
  charsList,
  onRestart,
}: {
  chain: string[];
  charsList: CharInfo[];
  onRestart: () => void;
}) {
  const text = chain.join(' → ');
  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制到剪贴板');
    } catch (e) {
      console.error('share failed', e);
    }
  };
  // 2026-07-03: read-all button. Sequential per-char calls would queue
  // 10 separate TTS requests + 10 audio.play() rounds; one batched
  // speak() (joined by space) hits the API once and streams one MP3.
  const handleReadAll = async () => {
    try {
      await speak(chain.join(' '));
    } catch (e) {
      console.error('read all failed', e);
    }
  };
  // Pinyin lookup for display only — the button reads the *char* (TTS
  // pronounces Chinese correctly; reading pinyin as Latin text would
  // sound like the letter "a" not the actual tone).
  const pinyinByChar = new Map(charsList.map((c) => [c.char, c.pinyin] as const));
  return (
    <div className="mx-auto max-w-md rounded-lg border bg-paper p-8 text-center">
      <h2 className="text-2xl font-bold">接龙结束</h2>
      <p className="mt-2 text-ink-soft">
        接龙长度: <span className="text-3xl text-seal">{chain.length}</span> 字
      </p>
      <div className="mt-4 max-h-32 overflow-y-auto rounded bg-paper-deep p-2 text-sm font-kai">
        {text}
      </div>
      <div className="mt-4 flex justify-center">
        <ReadAloudButton text={chain.join(' ')} label="朗读全部" size="sm" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {chain.map((c) => (
          <div
            key={c}
            className="flex flex-col items-center gap-1 rounded border border-ink/10 bg-paper-soft p-2"
          >
            <span className="font-kai text-2xl text-ink">{c}</span>
            {pinyinByChar.get(c) && (
              <span className="text-xs text-ink-faint">{pinyinByChar.get(c)}</span>
            )}
            <ReadAloudButton text={c} label="读音" size="sm" variant="seal" />
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-center gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="rounded-md bg-seal px-4 py-2 text-white hover:bg-seal/80"
        >
          再来一局
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="rounded-md border border-ink/20 px-4 py-2 hover:bg-paper-deep"
        >
          分享
        </button>
      </div>
    </div>
  );
}
