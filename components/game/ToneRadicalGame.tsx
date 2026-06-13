'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchGameRound, type GameRound } from '@/lib/api-game';
import { ToneToken } from './ToneToken';
import { RadicalToken } from './RadicalToken';
import { ToneRadicalChar } from './ToneRadicalChar';
import type { Tone } from '@/lib/pinyin-tone';

type Phase = 'loading' | 'round1' | 'round2' | 'finished';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function ToneRadicalGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [round, setRound] = useState<GameRound | null>(null);
  // char → matched tone (round 1) and radical (round 2)
  const [toneMatches, setToneMatches] = useState<Record<string, Tone>>({});
  const [radicalMatches, setRadicalMatches] = useState<Record<string, string>>({});
  const [mismatches, setMismatches] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef(0);
  const [toneOrder, setToneOrder] = useState<Tone[]>([]);
  const [radicalOrder, setRadicalOrder] = useState<string[]>([]);

  const loadGame = async () => {
    setPhase('loading');
    setToneMatches({});
    setRadicalMatches({});
    setMismatches(0);
    setElapsedMs(0);
    try {
      const r = await fetchGameRound(4);
      setRound(r);
      setToneOrder(shuffle([...r.toneChoices] as Tone[]));
      setRadicalOrder(shuffle([...r.radicalChoices]));
      startedAt.current = Date.now();
      setPhase('round1');
    } catch (e) {
      console.error('loadGame failed', e);
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

  // Auto-advance round1 → round2 when all matched
  useEffect(() => {
    if (phase !== 'round1' || !round) return;
    if (Object.keys(toneMatches).length === round.chars.length) {
      const t = setTimeout(() => setPhase('round2'), 800);
      return () => clearTimeout(t);
    }
  }, [toneMatches, phase, round]);

  // Auto-advance round2 → finished
  useEffect(() => {
    if (phase !== 'round2' || !round) return;
    if (Object.keys(radicalMatches).length === round.chars.length) {
      const t = setTimeout(() => setPhase('finished'), 800);
      return () => clearTimeout(t);
    }
  }, [radicalMatches, phase, round]);

  const handleDrop = (char: string, kind: 'tone' | 'radical', payload: string) => {
    if (!round) return;
    const answer = round.charToAnswer[char];
    if (!answer) return;
    const expected = kind === 'tone' ? String(answer.tone) : answer.radical;
    if (payload !== expected) {
      setMismatches((m) => m + 1);
      return;
    }
    if (kind === 'tone') {
      setToneMatches((prev) => ({ ...prev, [char]: Number(payload) as Tone }));
    } else {
      setRadicalMatches((prev) => ({ ...prev, [char]: payload }));
    }
  };

  const accuracy = useMemo(() => {
    const total = mismatches + Object.keys(toneMatches).length + Object.keys(radicalMatches).length;
    if (total === 0) return 1;
    return (Object.keys(toneMatches).length + Object.keys(radicalMatches).length) / total;
  }, [mismatches, toneMatches, radicalMatches]);

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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between text-sm text-ink-soft">
        <div>用时: {formatTime(elapsedMs)}</div>
        <div>第 {phase === 'round1' ? '一' : '二'} 轮 · 错配: {mismatches}</div>
        <button type="button" onClick={() => setPhase('finished')} className="text-ink-faint hover:underline">
          放弃
        </button>
      </div>

      <h3 className="text-center font-kai text-lg text-ink-soft">
        {phase === 'round1' ? '把声调拖到对应的字上' : '把部首拖到对应的字上'}
      </h3>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {round.chars.map((c) => (
          <ToneRadicalChar
            key={c.char}
            char={c.char}
            pinyin={c.pinyin}
            matchedTone={toneMatches[c.char] ?? null}
            matchedRadical={radicalMatches[c.char] ?? null}
            onDrop={(kind, payload) => handleDrop(c.char, kind, payload)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {phase === 'round1'
          ? toneOrder.map((t) => (
              <ToneToken
                key={t}
                tone={t}
                matched={Object.values(toneMatches).includes(t)}
                onDragStart={() => {}}
              />
            ))
          : radicalOrder.map((r) => (
              <RadicalToken
                key={r}
                radical={r}
                matched={Object.values(radicalMatches).includes(r)}
                onDragStart={() => {}}
              />
            ))}
      </div>
    </div>
  );
}