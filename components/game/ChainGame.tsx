'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchChainChars } from '@/lib/api-chain';
import { buildChainCharIndex, getValidNextCharsFromIndex, pickStarter } from '@/lib/chain-rules';
import type { CharInfo } from '@/lib/chain-types';
import { CHAIN_GAME_CONFIG } from '@/lib/difficulty';
import { useDifficulty } from '@/lib/use-difficulty';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { getRevealConfig, type RevealElement } from '@/lib/reveal';
import { ChainScroll } from './ChainScroll';
import { ChainPickerModal } from './ChainPickerModal';
import { ChainSummary } from './ChainSummary';
import { FallbackBanner } from './FallbackBanner';
import type { LegacyGameProps } from '@/components/game/LegacyGameResult';

type Phase = 'loading' | 'playing' | 'finished' | 'error';

export function ChainGame(props: LegacyGameProps = {}) {
  const { onComplete } = props;
  const [phase, setPhase] = useState<Phase>('loading');
  const [charsList, setCharsList] = useState<CharInfo[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const [starter, setStarter] = useState<string>('');
  // 2026-07-05 (Task 12 I2): surface hskFallback from /api/chain/chars so
  // <FallbackBanner /> tells the user their HSK selection isn't fully
  // supported yet (matches ToneRadicalGame + DragMatchGame pattern).
  const [hskFallback, setHskFallback] = useState(false);
  // Bumped by the retry button — the effect below reloads the char pool.
  const [reloadToken, setReloadToken] = useState(0);
  const { difficulty, setDifficulty, hskLevel, ready } = useDifficulty();

  // 2026-10-25 (Task 7): the finished chain is reported through the
  // optional `onComplete` prop. The chain game has no clock, so the result
  // carries no duration — the daily card shows the score anyway.
  //
  // `onComplete` fires exactly once per finished ROUND. The ref is reset
  // when the chain restarts, so the second chain of a session reports its
  // own length too.
  const reportedRef = useRef(false);
  // The callback lives in a ref so a parent re-render (a new inline arrow
  // on every render) cannot disturb the finish effect below.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // 2026-07-04 W3 fold-in: AbortController guards the async fetch so
  // unmounting mid-fetch (or rapid difficulty switching) doesn't call
  // setState on an unmounted component. Note: fetchChainChars is a
  // module-level memoized promise — the AbortController doesn't cancel
  // the network request itself, but it prevents the `.then()` chain
  // from mutating state after cleanup.
  // The wait for `ready` avoids a second request: the stored difficulty is
  // only known after the browser has read localStorage.
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    void (async () => {
      setPhase('loading');
      try {
        const source = CHAIN_GAME_CONFIG[difficulty].source;
        const result = await fetchChainChars(source, hskLevel);
        if (ctrl.signal.aborted) return;
        const s = pickStarter(result.chars);
        if (!s) throw new Error('no valid starter');
        setCharsList(result.chars);
        setHskFallback(result.hskFallback);
        setStarter(s.char);
        setChain([s.char]);
        // 2026-10-25 (Task 7, fix round 1): a new ROUND starts here — the
        // fire-once guard belongs to the round, not to the mount, so a chain
        // started after a difficulty/HSK change reports its own length.
        reportedRef.current = false;
        setPhase('playing');
      } catch (e) {
        if (ctrl.signal.aborted) return;
        console.error('startGame failed', e);
        setPhase('error');
      }
    })();
    return () => ctrl.abort();
  }, [ready, difficulty, hskLevel, reloadToken]);

  const usedChars = useMemo(() => new Set(chain), [chain]);
  // The pool can hold thousands of chars; the index is built once per
  // pool instead of rescanning it on every pick.
  const charIndex = useMemo(() => buildChainCharIndex(charsList), [charsList]);
  const validNext = useMemo(
    () =>
      chain.length === 0
        ? []
        : getValidNextCharsFromIndex(charIndex, chain[chain.length - 1]!, usedChars),
    [charIndex, chain, usedChars],
  );

  // 2026-07-04: HSK reveal — chain game has onDemandPenalty=0 so on-demand
  // reveals don't bump mismatches; the handler is a no-op for chain since
  // there's no score system (per reveal.ts: PENALTY_BY_GAME.chain = 0).
  const revealConfig = useMemo(() => getRevealConfig('chain', hskLevel), [hskLevel]);
  const handleDemand = useCallback((_el: RevealElement) => {
    /* no-op: chain has no penalty system */
  }, []);

  useEffect(() => {
    if (phase === 'playing' && validNext.length === 0 && chain.length > 0) {
      setPhase('finished');
      // 2026-10-25 (Task 7): the chain is over — report its length. The
      // ref guard makes the report happen once per chain; the effect
      // re-runs whenever `validNext` changes. ChainGame has no 放弃
      // button, so there is no abandoned case to guard here.
      if (!reportedRef.current) {
        reportedRef.current = true;
        onCompleteRef.current?.({ correct: chain.length, wrong: 0 });
      }
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
          onClick={() => setReloadToken((token) => token + 1)}
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
          // 2026-10-25 (Task 7): a new ROUND starts — the fire-once guard
          // belongs to the chain, not to the mount, so the restarted chain
          // reports its own length.
          reportedRef.current = false;
          setChain([starter]);
          setPhase('playing');
        }}
      />
    );
  }

  // Lookup by index — `charsList.find` rescanned the whole pool on every
  // render just to show the previous char's pinyin.
  const currentLast =
    chain.length === 0 ? undefined : charIndex.byChar.get(chain[chain.length - 1]!);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <DifficultyPicker
          value={difficulty}
          onChange={(d) => {
            // The round is reloaded by the effect above — starting it here
            // as well would send the request twice.
            setDifficulty(d);
          }}
        />
        <div className="text-xs text-ink-faint">字库难度</div>
      </div>
      <FallbackBanner hskLevel={hskLevel} available={!hskFallback} />
      <ChainScroll
        chain={chain}
        charsList={charsList}
        revealConfig={revealConfig}
        onDemandReveal={handleDemand}
      />
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
      <ChainPickerModal validChars={validNext} onSelect={(c) => setChain((prev) => [...prev, c])} />
    </div>
  );
}
