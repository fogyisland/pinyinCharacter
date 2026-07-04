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

export function ToneRadicalGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [round, setRound] = useState<GameRound | null>(null);
  const [error, setError] = useState<string | null>(null);
  // char → matched payload (tone number / radical / pinyin string)
  const [matches, setMatches] = useState<Record<string, string>>({});
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
  const { difficulty, setDifficulty, hskLevel } = useDifficulty();

  const revealConfig = useMemo(
    () => getRevealConfig('tone-radical', hskLevel),
    [hskLevel],
  );

  const handleDemand = useCallback((_el: RevealElement) => {
    setMismatches((m) => m + revealConfig.onDemandPenalty);
  }, [revealConfig.onDemandPenalty]);

  const loadGame = async (forceDifficulty: Difficulty = difficulty) => {
    setPhase('loading');
    setMatches({});
    setMismatches(0);
    setElapsedMs(0);
    setError(null);
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
      const res = await fetch(`/api/game/round?${params.toString()}`);
      const json = (await res.json()) as { ok: boolean; data: GameRound; hskFallback?: boolean; error?: { code: string } };
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
      console.error('loadGame failed', e);
      setError(e instanceof Error ? e.message : '加载失败');
    }
  };

  useEffect(() => { void loadGame(); }, []);

  useEffect(() => {
    if (phase === 'finished') return;
    const handle = setInterval(() => {
      setElapsedMs(Date.now() - startedAt.current);
    }, 100);
    return () => clearInterval(handle);
  }, [phase]);

  // Auto-finish when all chars matched
  useEffect(() => {
    if (phase !== 'playing' || !round) return;
    if (Object.keys(matches).length === round.chars.length) {
      const t = setTimeout(() => setPhase('finished'), 800);
      return () => clearTimeout(t);
    }
  }, [matches, phase, round]);

  const handleDrop = (char: string, kind: GameRound['mode'], payload: string) => {
    if (!round || kind !== round.mode) return;
    const answer = round.charToAnswer[char];
    if (!answer) return;
    const expected =
      round.mode === 'tone' ? String(answer.tone) :
      round.mode === 'radical' ? answer.radical :
      answer.pinyin;
    if (payload !== expected) {
      setMismatches((m) => m + 1);
      return;
    }
    setMatches((prev) => ({ ...prev, [char]: payload }));
  };

  const accuracy = useMemo(() => {
    const total = mismatches + Object.keys(matches).length;
    if (total === 0) return 1;
    return Object.keys(matches).length / total;
  }, [mismatches, matches]);

  if (error) {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-paper p-8 text-center">
        <h2 className="text-xl font-bold text-seal">出错了</h2>
        <p className="mt-2 text-ink-soft">{error}</p>
        <p className="mt-1 text-sm text-ink-faint">
          如果提示「not enough rare chars」,请运行
          <code className="mx-1 rounded bg-paper-deep px-1">pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts</code>
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

  // Compute which token values are still available (not yet matched to any char)
  const matchedValues = new Set(Object.values(matches));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <DifficultyPicker value={difficulty} onChange={(d) => { setDifficulty(d); void loadGame(d); }} />
        <div className="text-xs text-ink-faint">本轮:{modeInfo.subject}</div>
      </div>
      <div className="flex items-center justify-between text-sm text-ink-soft">
        <div>用时: {formatTime(elapsedMs)}</div>
        <div>错配: {mismatches}</div>
        <button type="button" onClick={() => setPhase('finished')} className="text-ink-faint hover:underline">
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
        {mode === 'tone' && toneOrder.map((t) => (
          <ToneToken
            key={t}
            tone={t}
            matched={matchedValues.has(String(t))}
            onDragStart={() => {}}
          />
        ))}
        {mode === 'radical' && radicalOrder.map((r) => (
          <RadicalToken
            key={r}
            radical={r}
            matched={matchedValues.has(r)}
            onDragStart={() => {}}
          />
        ))}
        {mode === 'pinyin' && pinyinOrder.map((p) => (
          <PinyinToken
            key={p}
            pinyin={p}
            matched={matchedValues.has(p)}
            onDragStart={() => {}}
          />
        ))}
      </div>
    </div>
  );
}
