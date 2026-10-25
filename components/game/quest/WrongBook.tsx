'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import type { WrongChar } from '@/lib/game-progress';

/**
 * The 生字本 - every char the learner has missed.
 *
 * The component owns no storage: the wrong book comes in as a prop and a
 * removal leaves through `onRemove`, so the page-level task stays the single
 * writer of the store.
 */
export interface WrongBookProps {
  wrong: Record<string, WrongChar>;
  onRemove: (char: string) => void;
}

/** `POST /api/worksheets` caps `content` at 500 chars - the client may not send more. */
const WORKSHEET_LIMIT = 500;

interface WorksheetResponse {
  ok: boolean;
  data?: { id?: string };
  error?: { code?: string; message?: string };
}

export function WrongBook({ wrong, onRemove }: WrongBookProps) {
  const user = useAppStore((state) => state.user);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const entries = Object.entries(wrong);
  const chars = entries.map(([char]) => char);
  const capped = chars.slice(0, WORKSHEET_LIMIT);
  const isCapped = chars.length > WORKSHEET_LIMIT;

  async function createWorksheet(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '生字本练习',
          content: capped,
          cellStyle: 'brush-square',
          paperSize: 'A4',
          fontFamily: 'kai',
        }),
      });
      const body = (await res.json()) as WorksheetResponse;
      const id = body.ok && body.data ? body.data.id : undefined;
      if (!res.ok || !body.ok || !id) {
        setMessage('字帖暂时生成不了，请稍后再试');
        return;
      }
      router.push(`/worksheet/${id}`);
    } catch (failure) {
      console.warn('[wrong-book] the worksheet could not be created', failure);
      setMessage('字帖暂时生成不了，请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  if (entries.length === 0) {
    return <p className="py-10 text-center text-ink-faint">生字本还是空的 —— 去闯关</p>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">生字本 · {chars.length} 字</p>
        <div className="flex items-center gap-2">
          {isCapped ? (
            <span className="text-xs text-ink-faint">本次生成前 {WORKSHEET_LIMIT} 字</span>
          ) : null}
          {user ? (
            <button
              type="button"
              onClick={() => void createWorksheet()}
              disabled={busy}
              className="rounded border border-seal bg-seal px-3 py-1.5 text-sm text-paper-soft hover:opacity-90 disabled:opacity-60"
            >
              {busy ? '生成中…' : '一键生成字帖'}
            </button>
          ) : (
            <span className="text-xs text-ink-faint">登录后可一键生成字帖</span>
          )}
        </div>
      </div>

      {message ? <p className="mb-2 text-xs text-danger">{message}</p> : null}

      <ul className="space-y-2">
        {entries.map(([char, snapshot]) => {
          const pinyin = snapshot.pinyin ?? '';
          const plainPinyin = snapshot.plainPinyin ?? '';
          const toneName = snapshot.toneName ?? '';
          const radical = snapshot.radical ?? '';
          const meaning = snapshot.meaningShort ?? '';
          const count = typeof snapshot.count === 'number' ? snapshot.count : 0;
          // A missing tier or level must not produce `?hsk=undefined`.
          const hsk = typeof snapshot.hsk === 'number' ? snapshot.hsk : 1;
          const level = typeof snapshot.level === 'number' ? snapshot.level : 1;
          const reading = pinyin || plainPinyin;

          return (
            <li
              key={char}
              data-char={char}
              className="flex items-center gap-3 rounded border border-ink/15 bg-paper px-3 py-2"
            >
              <span className="font-kai text-3xl leading-none text-ink">{char}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  <span data-reading="">{reading}</span>
                  {toneName ? (
                    <span className="ml-1 text-xs text-ink-faint">{toneName}</span>
                  ) : null}
                </p>
                {radical ? (
                  <p className="text-xs text-ink-faint">
                    部首 <span data-radical="">{radical}</span>
                  </p>
                ) : null}
                {meaning ? (
                  <p data-meaning="" className="truncate text-xs text-ink-soft">
                    {meaning}
                  </p>
                ) : null}
                <p className="text-xs text-ink-faint">错 {count} 次</p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                <a
                  href={`/game?tab=quest&hsk=${hsk}&level=${level}`}
                  className="text-seal hover:underline"
                >
                  再练一次
                </a>
                <a href={`/worksheet?prefill=${char}`} className="text-seal hover:underline">
                  练字帖
                </a>
                <button
                  type="button"
                  onClick={() => onRemove(char)}
                  className="text-ink-faint hover:text-danger"
                >
                  移出生字本
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
