'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { DRAG_MATCH_CONFIG, type Difficulty } from '@/lib/difficulty';
import { useDifficulty } from '@/lib/use-difficulty';
import { fetchChars } from '@/lib/api-chars';
import { DraggablePinyin } from './DraggablePinyin';
import { CharDropZone } from './CharDropZone';

interface Char {
  char: string;
  pinyin: string;
  meaning: string;
}

type Phase = 'loading' | 'playing' | 'finished';

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
  const { difficulty, setDifficulty } = useDifficulty();

  useEffect(() => {
    loadGame();
  }, []);

  useEffect(() => {
    if (phase !== 'playing') return;
    const handle = setInterval(() => {
      setElapsedMs(Date.now() - startedAt.current);
    }, 100);
    return () => clearInterval(handle);
  }, [phase]);

  const loadGame = async (forceDifficulty: Difficulty = difficulty) => {
    setPhase('loading');
    const cfg = DRAG_MATCH_CONFIG[forceDifficulty];

    let chars: Char[] = [];
    if (cfg.source === 'chars-level-1') {
      const r = await fetchChars({ level: 1, page: 1 });
      chars = r.chars.filter((c) => c.meaningZh).map(toChar);
    } else if (cfg.source === 'chars-level-1-2') {
      const r = await fetchChars({ page: 1 });
      chars = r.chars.filter((c) => c.meaningZh && (c.level === 1 || c.level === 2)).map(toChar);
    } else {
      const r = await fetchChars({ page: 1 });
      chars = r.chars.filter((c) => c.meaningZh).map(toChar);
    }

    const picked = shuffle(chars).slice(0, cfg.count);
    setChars(picked);
    setPinyinOrder(shuffle(picked.map((c) => c.pinyin)));
    setPairs({});
    setMismatches(0);
    setElapsedMs(0);
    startedAt.current = Date.now();
    setPhase('playing');
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

  if (phase === 'finished') {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-paper p-8 text-center">
        <h2 className="text-2xl font-bold">完成!</h2>
        <p className="mt-2 text-ink-soft">用时: {formatTime(elapsedMs)}</p>
        <p className="mt-1 text-ink-soft">正确率: {Math.round(accuracy * 100)}%</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => { void loadGame(); }}
            className="rounded-md bg-seal px-4 py-2 text-white hover:bg-seal/80"
          >
            再来一局
          </button>
          <a
            href="/"
            className="rounded-md border border-ink/20 px-4 py-2 hover:bg-paper-deep"
          >
            返回首页
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between mb-2">
        <DifficultyPicker value={difficulty} onChange={(d) => { setDifficulty(d); void loadGame(d); }} />
      </div>
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-soft">用时: {formatTime(elapsedMs)}</div>
        <div className="text-sm text-ink-soft">错配: {mismatches}</div>
        <button
          type="button"
          onClick={() => setPhase('finished')}
          className="text-sm text-ink-faint hover:underline"
        >
          放弃
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-ink-soft">字</h3>
          {chars.map((c) => (
            <CharDropZone
              key={c.char}
              charId={c.char}
              char={c.char}
              matchedPinyin={pairs[c.char] ?? null}
              onDrop={handleDrop}
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
