'use client';

import { useEffect, useRef, useState } from 'react';
import { PinyinOutput } from './PinyinOutput';
import { ReadAloudButton } from './ReadAloudButton';
import { textToPinyin, renderWithSpaces, renderWithoutSpaces, type PinyinToken } from '@/lib/pinyin-client';
import { useAppStore } from '@/lib/store';
import { createHistoryRequest } from '@/lib/api-history';

export function TextToPinyin() {
  const [text, setText] = useState('');
  const [withSpaces, setWithSpaces] = useState(true);
  const [tokens, setTokens] = useState<PinyinToken[]>([]);
  const user = useAppStore(s => s.user);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<{ input: string; ts: number } | null>(null);

  // 字 → 拼音：实时
  useEffect(() => {
    if (!text.trim()) { setTokens([]); return; }
    setTokens(textToPinyin(text));
  }, [text]);

  // 自动入库：1.5s debounce
  useEffect(() => {
    if (!user) return;
    if (!text.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void saveHistory(text); }, 1500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, user]);

  // unmount 时 flush
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (user && text.trim()) void saveHistory(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveHistory(input: string) {
    if (!user) return;
    const last = lastSavedRef.current;
    if (last && last.input === input && Date.now() - last.ts < 60_000) return;
    try {
      await createHistoryRequest({
        kind: 'text2pinyin', input, output: null, char_count: input.length, dedup: true,
      });
      lastSavedRef.current = { input, ts: Date.now() };
    } catch (e) { console.error('history save failed', e); }
  }

  const rendered = text.trim()
    ? (withSpaces ? renderWithSpaces(tokens) : renderWithoutSpaces(tokens))
    : '';

  return (
    <section className="card-paper p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">字 → 拼音</h2>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={withSpaces} onChange={e => setWithSpaces(e.target.checked)} />
            带空格
          </label>
        </div>
      </div>
      <textarea
        className="w-full border rounded p-2 min-h-24"
        placeholder="输入汉字，如「你好世界」"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      {rendered && (
        <div className="space-y-2">
          <PinyinOutput tokens={tokens} withSpaces={withSpaces} />
          <div className="flex gap-2">
            <ReadAloudButton text={text} />
            <button
              type="button"
              className="text-sm px-3 py-1 border rounded hover:bg-paper-deep"
              onClick={async () => { await navigator.clipboard.writeText(rendered); }}
            >复制</button>
            <button
              type="button"
              className="text-sm px-3 py-1 border rounded hover:bg-paper-deep ml-auto"
              onClick={() => setText('')}
            >清空</button>
          </div>
        </div>
      )}
    </section>
  );
}
