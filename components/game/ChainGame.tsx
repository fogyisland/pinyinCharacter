'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchChainChars } from '@/lib/api-chain';
import { getValidNextChars, pickStarter } from '@/lib/chain-rules';
import type { CharInfo } from '@/lib/chain-types';
import { CHAIN_GAME_CONFIG, type Difficulty } from '@/lib/difficulty';
import { useDifficulty } from '@/lib/use-difficulty';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { ChainScroll } from './ChainScroll';
import { ChainPickerModal } from './ChainPickerModal';
import { ChainSummary } from './ChainSummary';

type Phase = 'loading' | 'playing' | 'finished' | 'error';

export function ChainGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [charsList, setCharsList] = useState<CharInfo[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const [starter, setStarter] = useState<string>('');
  const { difficulty, setDifficulty, hskLevel } = useDifficulty();

  // 2026-07-04 W3 fold-in: AbortController guards the async fetch so
  // unmounting mid-fetch (or rapid difficulty switching) doesn't call
  // setState on an unmounted component. Note: fetchChainChars is a
  // module-level memoized promise — the AbortController doesn't cancel
  // the network request itself, but it prevents the `.then()` chain
  // from mutating state after cleanup.
  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      setPhase('loading');
      try {
        const source = CHAIN_GAME_CONFIG[difficulty].source;
        const chars = await fetchChainChars(source, hskLevel);
        if (ctrl.signal.aborted) return;
        console.log('[chain] startGame', { source, hskLevel, count: chars.length });
        const s = pickStarter(chars);
        if (!s) throw new Error('no valid starter');
        setCharsList(chars);
        setStarter(s.char);
        setChain([s.char]);
        setPhase('playing');
      } catch (e) {
        if (ctrl.signal.aborted) return;
        console.error('startGame failed', e);
        setPhase('error');
      }
    })();
    return () => ctrl.abort();
  }, [difficulty, hskLevel]);

  async function startGame(forceDifficulty: Difficulty = difficulty) {
    // 2026-07-04: DifficultyPicker's onChange used to call startGame(d)
    // which did its own fetchChainChars. Now that the useEffect above
    // is the canonical fetch path, the onChange handler just delegates
    // to setDifficulty — the useEffect re-runs when difficulty changes.
    // The retry button on the error state still calls startGame() with
    // no arg; that's a no-op re-trigger of the same path (deps unchanged).
    setDifficulty(forceDifficulty);
  }

  const usedChars = useMemo(() => new Set(chain), [chain]);
  const validNext = useMemo(
    () => (chain.length === 0 ? [] : getValidNextChars(charsList, chain.at(-1)!, usedChars)),
    [charsList, chain, usedChars],
  );

  useEffect(() => {
    if (phase === 'playing' && validNext.length === 0 && chain.length > 0) {
      setPhase('finished');
    }
  }, [phase, validNext.length, chain.length]);

  if (phase === 'loading') {
    return <div className="py-12 text-center text-ink-faint">加载中...</div>;
  }
  if (phase === 'error') {
    return (
      <div className="py-12 text-center">
        <p className="text-seal">字库加载失败</p>
        <button
          type="button"
          onClick={() => void startGame()}
          className="mt-4 rounded-md bg-seal px-4 py-2 text-white"
        >
          重试
        </button>
      </div>
    );
  }
  if (phase === 'finished') {
    return (
      <ChainSummary
        chain={chain}
        charsList={charsList}
        onRestart={() => {
          setChain([starter]);
          setPhase('playing');
        }}
      />
    );
  }

  const currentLast = charsList.find((c) => c.char === chain.at(-1));
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <DifficultyPicker
          value={difficulty}
          onChange={(d) => { setDifficulty(d); void startGame(d); }}
        />
        <div className="text-xs text-ink-faint">字库难度</div>
      </div>
      <ChainScroll chain={chain} charsList={charsList} />
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-soft">接龙长度: {chain.length}</div>
        <button
          type="button"
          disabled={chain.length < 2}
          onClick={() => setChain((prev) => prev.slice(0, -1))}
          className="text-sm text-ink-faint hover:underline disabled:opacity-30"
        >
          换一条
        </button>
      </div>
      {currentLast && (
        <div className="text-center text-xs text-ink-faint">
          上一个字: {currentLast.char} {currentLast.pinyin}
        </div>
      )}
      <ChainPickerModal
        validChars={validNext}
        onSelect={(c) => setChain((prev) => [...prev, c])}
      />
    </div>
  );
}
