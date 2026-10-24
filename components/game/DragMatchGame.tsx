'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { DRAG_MATCH_CONFIG, type Difficulty } from '@/lib/difficulty';
import { useDifficulty } from '@/lib/use-difficulty';
import { fetchChars } from '@/lib/api-chars';
import { getRevealConfig, type RevealElement } from '@/lib/reveal';
import { FallbackBanner } from './FallbackBanner';
import { DraggablePinyin } from './DraggablePinyin';
import { CharDropZone } from './CharDropZone';

interface Char {
  char: string;
  pinyin: string;
  meaning: string;
}

type Phase = 'loading' | 'playing' | 'finished' | 'error';

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function toChar(c: { char: string; pinyin: string; meaningZh: string | null }): Char {
  return { char: c.char, pinyin: c.pinyin, meaning: c.meaningZh ?? '' };
}

export function DragMatchGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [chars, setChars] = useState<Char[]>([]);
  const [pinyinOrder, setPinyinOrder] = useState<string[]>([]);
  const [pairs, setPairs] = useState<Record<string, string>>({}); // charId -> pinyinId
  const [mismatches, setMismatches] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number>(0);
  // 2026-07-04: T9 HSK wiring — /api/chars returns hskFallback (currently
  // always false per app/api/chars/route.ts) so the client can decide to
  // show <FallbackBanner />.
  const [hskFallback, setHskFallback] = useState(false);
  const { difficulty, setDifficulty, hskLevel, ready } = useDifficulty();
  // Every new round cancels the request of the previous one, so a fast
  // difficulty switch cannot render an outdated round.
  const abortRef = useRef<AbortController | null>(null);

  const revealConfig = useMemo(() => getRevealConfig('drag-match', hskLevel), [hskLevel]);

  const handleDemand = useCallback(
    (_el: RevealElement) => {
      setMismatches((m) => m + revealConfig.onDemandPenalty);
    },
    [revealConfig.onDemandPenalty],
  );

  // 2026-07-05 (Task 12 I1): depend on hskLevel + difficulty so picking a
  // different HSK chip in GameModeTabs refetches the char pool. Previously
  // mount-only — revealConfig would recompute but chars stayed stale.
  // The wait for `ready` avoids a second request: the stored difficulty is
  // only known after the browser has read localStorage.
  useEffect(() => {
    if (!ready) return;
    void loadGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hskLevel, difficulty]);

  // Stop an in-flight round request when the component goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  // The clock shows whole seconds, so it ticks once per second. It used to
  // tick every 100 ms, which re-rendered the whole board ten times a second.
  useEffect(() => {
    if (phase !== 'playing') return;
    const handle = setInterval(() => {
      setElapsedMs(Date.now() - startedAt.current);
    }, 1000);
    return () => clearInterval(handle);
  }, [phase]);

  const loadGame = async (forceDifficulty: Difficulty = difficulty) => {
    setPhase('loading');
    const cfg = DRAG_MATCH_CONFIG[forceDifficulty];
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let chars: Char[] = [];
      let fallback = false;
      // 2026-07-04: T9 — pass hskLevel through fetchChars so /api/chars filters
      // by the HSK column. The legacy `level` param is left untouched for
      // backwards compat with the chars-level-1/1-2/all sources.
      if (cfg.source === 'chars-level-1') {
        const r = await fetchChars({ level: 1, hskLevel, page: 1, signal: controller.signal });
        chars = r.chars.filter((c) => c.meaningZh).map(toChar);
        fallback = r.hskFallback;
      } else if (cfg.source === 'chars-level-1-2') {
        const r = await fetchChars({ hskLevel, page: 1, signal: controller.signal });
        chars = r.chars.filter((c) => c.meaningZh && (c.level === 1 || c.level === 2)).map(toChar);
        fallback = r.hskFallback;
      } else {
        const r = await fetchChars({ hskLevel, page: 1, signal: controller.signal });
        chars = r.chars.filter((c) => c.meaningZh).map(toChar);
        fallback = r.hskFallback;
      }

      if (controller.signal.aborted) return;

      const picked = shuffle(chars).slice(0, cfg.count);
      setChars(picked);
      setPinyinOrder(shuffle(picked.map((c) => c.pinyin)));
      setPairs({});
      setMismatches(0);
      setElapsedMs(0);
      startedAt.current = Date.now();
      // Capture hskFallback from the response envelope. /api/chars currently
      // returns hskFallback=false; the flag is read from the same response as
      // the characters — the game used to send a second request just to
      // learn the value.
      setHskFallback(fallback);
      setPhase('playing');
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error('loadGame failed', e);
      setPhase('error');
    }
  };

  const handleDragStart = (e: React.DragEvent, pinyin: string) => {
    e.dataTransfer.setData('text/plain', pinyin);
  };

  const handleDrop = (char: string, pinyin: string) => {
    if (pairs[char]) return; // already matched
    if (pinyin !== getPinyinFor(char)) {
      setMismatches((m) => m + 1);
      return;
    }
    setPairs((prev) => {
      const next = { ...prev, [char]: pinyin };
      if (Object.keys(next).length === chars.length) {
        setElapsedMs(Date.now() - startedAt.current);
        setPhase('finished');
      }
      return next;
    });
  };

  const getPinyinFor = (char: string) => chars.find((c) => c.char === char)?.pinyin ?? '';

  const accuracy = useMemo(() => {
    const total = mismatches + Object.keys(pairs).length;
    if (total === 0) return 1;
    return Object.keys(pairs).length / total;
  }, [mismatches, pairs]);

  if (phase === 'loading') {
    return <div className="py-12 text-center text-ink-faint">加载中...</div>;
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-paper p-8 text-center">
        <h2 className="text-xl font-bold text-seal">出错了</h2>
        <p className="mt-2 text-ink-soft">加载字库失败,请重试</p>
        <button
          type="button"
          onClick={() => void loadGame()}
          className="mt-4 rounded-md bg-seal px-4 py-2 text-white hover:bg-seal/80"
        >
          重试
        </button>
      </div>
    );
  }

  if (phase === 'finished') {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-paper p-8 text-center">
        <h2 className="text-2xl font-bold">完成!</h2>
        <p className="mt-2 text-ink-soft">用时: {formatTime(elapsedMs)}</p>
        <p className="mt-1 text-ink-soft">正确率: {Math.round(accuracy * 100)}%</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              void loadGame();
            }}
            className="rounded-md bg-seal px-4 py-2 text-white hover:bg-seal/80"
          >
            再来一局
          </button>
          <a href="/" className="rounded-md border border-ink/20 px-4 py-2 hover:bg-paper-deep">
            返回首页
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between mb-2">
        <DifficultyPicker
          value={difficulty}
          onChange={(d) => {
            // The round is reloaded by the effect above — loading it here
            // as well would send the request twice.
            setDifficulty(d);
          }}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-soft">用时: {formatTime(elapsedMs)}</div>
        <div className="text-sm text-ink-soft">错配: {mismatches}</div>
        <button
          type="button"
          onClick={() => {
            setElapsedMs(Date.now() - startedAt.current);
            setPhase('finished');
          }}
          className="text-sm text-ink-faint hover:underline"
        >
          放弃
        </button>
      </div>

      <FallbackBanner hskLevel={hskLevel} available={!hskFallback} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-ink-soft">字</h3>
          {chars.map((c) => (
            <CharDropZone
              key={c.char}
              charId={c.char}
              char={c.char}
              pinyin={c.pinyin}
              meaning={c.meaning}
              matchedPinyin={pairs[c.char] ?? null}
              onDrop={handleDrop}
              revealConfig={revealConfig}
              onDemandReveal={handleDemand}
            />
          ))}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-ink-soft">拼音(拖动到对应字)</h3>
          {pinyinOrder.map((py) => {
            const matched = Object.values(pairs).includes(py);
            return (
              <DraggablePinyin
                key={py}
                id={py}
                text={py}
                matched={matched}
                onDragStart={handleDragStart}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
