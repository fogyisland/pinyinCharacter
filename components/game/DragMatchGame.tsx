'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

export function DragMatchGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [chars, setChars] = useState<Char[]>([]);
  const [pinyinOrder, setPinyinOrder] = useState<string[]>([]);
  const [pairs, setPairs] = useState<Record<string, string>>({}); // charId -> pinyinId
  const [mismatches, setMismatches] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number>(0);

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

  const loadGame = async () => {
    setPhase('loading');
    const res = await fetch('/api/rare-chars?page=1');
    const data = (await res.json()) as { ok: boolean; data: { chars: Char[] } };
    const filled = data.data.chars.filter((c) => c.meaning && c.pinyin);
    const picked = shuffle(filled).slice(0, 8);
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
    return <div className="py-12 text-center text-gray-500">加载中...</div>;
  }

  if (phase === 'finished') {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-white p-8 text-center">
        <h2 className="text-2xl font-bold">完成!</h2>
        <p className="mt-2 text-gray-600">用时: {formatTime(elapsedMs)}</p>
        <p className="mt-1 text-gray-600">正确率: {Math.round(accuracy * 100)}%</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={loadGame}
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            再来一局
          </button>
          <a
            href="/"
            className="rounded-md border border-gray-300 px-4 py-2 hover:bg-gray-100"
          >
            返回首页
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">用时: {formatTime(elapsedMs)}</div>
        <div className="text-sm text-gray-600">错配: {mismatches}</div>
        <button
          type="button"
          onClick={() => setPhase('finished')}
          className="text-sm text-gray-500 hover:underline"
        >
          放弃
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">字</h3>
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
          <h3 className="text-sm font-medium text-gray-700">拼音(拖动到对应字)</h3>
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
