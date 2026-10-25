'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameRound } from '@/lib/api-game';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { TONE_RADICAL_CONFIG, type Difficulty } from '@/lib/difficulty';
import { shuffle } from '@/lib/shuffle';
import { ToneToken } from './ToneToken';
import { RadicalToken } from './RadicalToken';
import { PinyinToken } from './PinyinToken';
import { ToneRadicalChar } from './ToneRadicalChar';
import { FallbackBanner } from './FallbackBanner';
import { useDifficulty } from '@/lib/use-difficulty';
import { getRevealConfig, type RevealElement } from '@/lib/reveal';
import type { Tone } from '@/lib/pinyin-tone';
import type { LegacyGameProps } from '@/components/game/LegacyGameResult';

type Phase = 'loading' | 'playing' | 'finished';

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const MODE_LABEL: Record<GameRound['mode'], { heading: string; subject: string }> = {
  tone: { heading: '把声调拖到对应的字上', subject: '声调' },
  radical: { heading: '把部首拖到对应的字上', subject: '部首' },
  pinyin: { heading: '把拼音拖到对应的字上', subject: '拼音' },
};

/**
 * 2026-10-25 (Task 5): the `mode` prop pins the round to a single focus.
 * When it is absent the request carries no `mode` parameter at all, so the
 * server keeps its legacy per-seed random mode.
 */
export interface ToneRadicalGameProps {
  mode?: 'tone' | 'radical';
}

export function ToneRadicalGame(props: ToneRadicalGameProps & LegacyGameProps = {}) {
  const { onComplete } = props;
  const [phase, setPhase] = useState<Phase>('loading');
  const [round, setRound] = useState<GameRound | null>(null);
  const [error, setError] = useState<string | null>(null);
  // char → matched payload (tone number / radical / pinyin string)
  const [matches, setMatches] = useState<Record<string, string>>({});
  // 2026-10-25 (Task 6): the token INDEXES that were already spent. The bank
  // holds one token per char, so two chars of the same tone own two
  // identical tokens — the index is the only thing that tells them apart.
  const [usedTokenIndices, setUsedTokenIndices] = useState<Set<number>>(new Set());
  const [mismatches, setMismatches] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef(0);
  const [toneOrder, setToneOrder] = useState<Tone[]>([]);
  const [radicalOrder, setRadicalOrder] = useState<string[]>([]);
  const [pinyinOrder, setPinyinOrder] = useState<string[]>([]);
  // 2026-07-04: HSK reveal wiring (Task 8). hskFallback is true when the
  // server couldn't satisfy the HSK filter and widened to the broader pool —
  // surface as <FallbackBanner /> so the user knows their HSK selection
  // isn't fully supported yet.
  const [hskFallback, setHskFallback] = useState(false);
  const { difficulty, setDifficulty, hskLevel, ready } = useDifficulty();
  // Every new round cancels the request of the previous one, so a fast
  // difficulty switch cannot render an outdated round.
  const abortRef = useRef<AbortController | null>(null);

  // 2026-10-25 (Task 7): the round's result is reported through the
  // optional `onComplete` prop. `abandoned` marks a round the learner gave
  // up on — an abandoned round is NOT a completed round, so it must never
  // be reported.
  const [abandoned, setAbandoned] = useState(false);
  // `onComplete` fires exactly once per finished ROUND. The ref is reset
  // whenever a new round starts, so the second round of a session reports
  // its own result too.
  const reportedRef = useRef(false);
  // The callback lives in a ref so a parent re-render (a new inline arrow
  // on every render) cannot restart the auto-finish timer below.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  // 2026-10-25 (Task 7, fix round 1): the mismatch count the auto-finish
  // timer reports. It lives in a ref so a mismatch (a hint reveal costs one
  // too) cannot re-arm the pending timer — the timer is scheduled once and
  // the report reads the count that is current when it fires. The ref is
  // kept in sync by the effect below, so it can never drift from the state.
  const mismatchesRef = useRef(0);
  useEffect(() => {
    mismatchesRef.current = mismatches;
  }, [mismatches]);

  const revealConfig = useMemo(() => getRevealConfig('tone-radical', hskLevel), [hskLevel]);

  // 2026-10-25 (Task 6): the token list the learner actually sees, in
  // display order. The index in the drag payload is an index into THIS array
  // (the component shuffles the bank client-side), so the value is resolved
  // from the same array. The tone bank holds numbers, so it is stringified
  // here — the comparison target is `String(answer.tone)`.
  const roundMode = round?.mode ?? null;
  const tokenValues = useMemo<string[]>(() => {
    if (roundMode === 'tone') return toneOrder.map((t) => String(t));
    if (roundMode === 'radical') return radicalOrder;
    if (roundMode === 'pinyin') return pinyinOrder;
    return [];
  }, [roundMode, toneOrder, radicalOrder, pinyinOrder]);

  const handleDemand = useCallback(
    (_el: RevealElement) => {
      setMismatches((m) => m + revealConfig.onDemandPenalty);
    },
    [revealConfig.onDemandPenalty],
  );

  const loadGame = async (forceDifficulty: Difficulty = difficulty) => {
    setPhase('loading');
    setMatches({});
    setUsedTokenIndices(new Set());
    // 2026-10-25 (Task 7): a new ROUND starts here — the abandon flag and
    // the fire-once guard belong to the round, not to the mount. Without
    // these resets the second round of a session could never report.
    setAbandoned(false);
    reportedRef.current = false;
    setMismatches(0);
    setElapsedMs(0);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const cfg = TONE_RADICAL_CONFIG[forceDifficulty];
      // 2026-07-03: pass `source` so easy/medium/hard pick from the
      // appropriate level pool (was using the default full pool for
      // all difficulties — caused "hard" to be much harder than
      // expected because rare chars had no matching token banks).
      // 2026-07-04: also pass `hskLevel` so the server can pre-filter
      // by HSK column and surface `hskFallback` for the FallbackBanner.
      const params = new URLSearchParams({
        count: String(cfg.count),
        source: cfg.source,
        hskLevel: String(hskLevel),
      });
      // 2026-10-25 (Task 5): only send `mode` when the caller pinned one.
      // An absent parameter keeps the server's legacy random mode — an
      // empty string would fail the route's zod enum.
      if (props.mode) params.set('mode', props.mode);
      const res = await fetch(`/api/game/round?${params.toString()}`, {
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        ok: boolean;
        data: GameRound;
        hskFallback?: boolean;
        error?: { code: string };
      };
      if (!json.ok) throw new Error(`fetchGameRound failed: ${json.error?.code ?? 'unknown'}`);
      const r = json.data;
      setRound(r);
      setHskFallback(json.hskFallback ?? true);
      setToneOrder(shuffle([...r.toneChoices]));
      setRadicalOrder(shuffle([...r.radicalChoices]));
      setPinyinOrder(shuffle([...r.pinyinChoices]));
      startedAt.current = Date.now();
      setPhase('playing');
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error('loadGame failed', e);
      setError(e instanceof Error ? e.message : '加载失败');
    }
  };

  // Stop an in-flight round request when the component goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  // 2026-07-05 (Task 12 I1): depend on hskLevel + difficulty so picking a
  // different HSK chip in GameModeTabs refetches the round. Previously
  // mount-only — revealConfig would recompute but round.chars stayed stale.
  // The wait for `ready` avoids a second request: the stored difficulty is
  // only known after the browser has read localStorage.
  // 2026-10-25 (Task 5): the pinned `mode` is a dependency too — a round
  // built for another mode has to be refetched.
  useEffect(() => {
    if (!ready) return;
    void loadGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hskLevel, difficulty, props.mode]);

  // The clock shows whole seconds, so it ticks once per second. It used to
  // tick every 100 ms, which re-rendered the whole board ten times a second.
  useEffect(() => {
    if (phase !== 'playing') return;
    const handle = setInterval(() => {
      setElapsedMs(Date.now() - startedAt.current);
    }, 1000);
    return () => clearInterval(handle);
  }, [phase]);

  // Auto-finish when all chars matched
  const matchCount = useMemo(() => Object.keys(matches).length, [matches]);
  useEffect(() => {
    if (phase !== 'playing' || !round) return;
    if (matchCount === round.chars.length) {
      const t = setTimeout(() => {
        // 2026-10-25 (Task 7): the round is over — report it.
        //
        // Belt and braces: React's cleanup already cancels the pending timer
        // when 放弃 flips the phase, so the guard is NOT the mechanism that
        // saves the day today. It is kept because the contract ("an
        // abandoned round is never reported") must not depend on the
        // dependency list and the abandon handler staying as they are — if
        // the click and this timer land in the same macrotask turn, the
        // state update may not have committed yet and the callback would
        // still see a stale `abandoned`.
        if (abandoned || reportedRef.current) return;
        reportedRef.current = true;
        const durationMs = Date.now() - startedAt.current;
        setElapsedMs(durationMs);
        setPhase('finished');
        onCompleteRef.current?.({
          correct: matchCount,
          wrong: mismatchesRef.current,
          durationMs,
        });
      }, 800);
      return () => clearTimeout(t);
    }
  }, [
    // `mismatches` is deliberately NOT a dependency: a mismatch would re-arm
    // the timer above and postpone the finish. The count is read from the
    // ref when the timer fires.
    matchCount,
    phase,
    round,
    abandoned,
  ]);

  const handleDrop = (char: string, kind: GameRound['mode'], payload: string) => {
    if (!round || kind !== round.mode) return;
    const answer = round.charToAnswer[char];
    if (!answer) return;
    // 2026-10-25 (Task 6, fix round 1): a slot that already holds its value
    // is closed. DropSlot fires onDrop for EVERY drop and `matched` only
    // changes the slot's styling, so without this guard a correct token
    // dropped onto a filled slot would run the match path: `setMatches`
    // would overwrite the same value (matchCount unchanged) while
    // `setUsedTokenIndices` would SPEND the token. The token would then be
    // gone without having matched a char, and the round would become
    // unwinnable — the very failure this task exists to eliminate. The drop
    // is inert: no token is spent and no mismatch is counted.
    //
    // `matches[char]` is typed `string` (noUncheckedIndexedAccess is off),
    // so `!== undefined` would not compile — `Object.hasOwn` is the check.
    if (Object.hasOwn(matches, char)) return;
    // 2026-10-25 (Task 6): the payload is the token's INDEX into the bank the
    // learner sees, not the value. A stale or malformed payload is ignored
    // instead of counting as a mismatch. `Number('')` is 0, so the empty
    // payload is rejected before the parse — otherwise a blank drop would
    // silently mean "the first token".
    if (payload.trim() === '') return;
    const tokenIndex = Number(payload);
    if (!Number.isInteger(tokenIndex)) return;
    const tokenValue = tokenValues[tokenIndex];
    if (tokenValue === undefined) return;
    // A token is spent once — dropping it again cannot match a second char.
    if (usedTokenIndices.has(tokenIndex)) return;
    const expected =
      round.mode === 'tone'
        ? String(answer.tone)
        : round.mode === 'radical'
          ? answer.radical
          : answer.pinyin;
    if (tokenValue !== expected) {
      setMismatches((m) => m + 1);
      return;
    }
    // The VALUE is stored, so the slot still shows the tone number or the
    // radical; the INDEX only tracks which token was spent.
    setMatches((prev) => ({ ...prev, [char]: tokenValue }));
    setUsedTokenIndices((prev) => new Set(prev).add(tokenIndex));
  };

  const accuracy = useMemo(() => {
    const total = mismatches + matchCount;
    if (total === 0) return 1;
    return matchCount / total;
  }, [mismatches, matchCount]);

  if (error) {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-paper p-8 text-center">
        <h2 className="text-xl font-bold text-seal">出错了</h2>
        <p className="mt-2 text-ink-soft">{error}</p>
        <p className="mt-1 text-sm text-ink-faint">
          如果提示「not enough rare chars」,请运行
          <code className="mx-1 rounded bg-paper-deep px-1">
            pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts
          </code>
          导入数据
        </p>
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

  if (phase === 'loading' || !round) {
    return <div className="py-12 text-center text-ink-faint">加载中...</div>;
  }

  if (phase === 'finished') {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-paper p-8 text-center">
        <h2 className="text-2xl font-bold">完成!</h2>
        <p className="mt-2 text-ink-soft">用时: {formatTime(elapsedMs)}</p>
        <p className="mt-1 text-ink-soft">错配: {mismatches}</p>
        <p className="mt-1 text-ink-soft">正确率: {Math.round(accuracy * 100)}%</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => void loadGame()}
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

  const mode = round.mode;
  const modeInfo = MODE_LABEL[mode];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <DifficultyPicker
          value={difficulty}
          onChange={(d) => {
            // The round is reloaded by the effect above — loading it here
            // as well would send the request twice.
            setDifficulty(d);
          }}
        />
        <div className="text-xs text-ink-faint">本轮:{modeInfo.subject}</div>
      </div>
      <div className="flex items-center justify-between text-sm text-ink-soft">
        <div>用时: {formatTime(elapsedMs)}</div>
        <div>错配: {mismatches}</div>
        <button
          type="button"
          onClick={() => {
            // 2026-10-25 (Task 7): giving up ENDS the round but does not
            // COMPLETE it — `abandoned` keeps the auto-finish timer from
            // reporting a score for a round the learner walked away from.
            setAbandoned(true);
            setElapsedMs(Date.now() - startedAt.current);
            setPhase('finished');
          }}
          className="text-ink-faint hover:underline"
        >
          放弃
        </button>
      </div>

      <h3 className="text-center font-kai text-lg text-ink-soft">{modeInfo.heading}</h3>

      <FallbackBanner hskLevel={hskLevel} available={!hskFallback} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {round.chars.map((c) => (
          <ToneRadicalChar
            key={c.char}
            char={c.char}
            pinyin={c.pinyin}
            radical={c.radical}
            meaning={c.meaning}
            slotKind={mode}
            matched={matches[c.char] ?? null}
            onDrop={(kind, payload) => handleDrop(c.char, kind, payload)}
            revealConfig={revealConfig}
            onDemandReveal={handleDemand}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {mode === 'tone' &&
          toneOrder.map((t, index) => (
            <ToneToken
              key={`tone-${index}`}
              tone={t}
              tokenIndex={index}
              matched={usedTokenIndices.has(index)}
              onDragStart={() => {}}
            />
          ))}
        {mode === 'radical' &&
          radicalOrder.map((r, index) => (
            <RadicalToken
              key={`radical-${index}`}
              radical={r}
              tokenIndex={index}
              matched={usedTokenIndices.has(index)}
              onDragStart={() => {}}
            />
          ))}
        {mode === 'pinyin' &&
          pinyinOrder.map((p, index) => (
            <PinyinToken
              key={`pinyin-${index}`}
              pinyin={p}
              tokenIndex={index}
              matched={usedTokenIndices.has(index)}
              onDragStart={() => {}}
            />
          ))}
      </div>
    </div>
  );
}
