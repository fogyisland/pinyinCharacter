'use client';

import { useState } from 'react';
import { fetchSentence } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { createHistoryRequest } from '@/lib/api-history';
import { hasTones } from '@/lib/pinyin-tone-decode';
import { ReadAloudButton } from './ReadAloudButton';

/** Which decoder answered. */
type Engine = 'tone-aware' | 'classic';

/**
 * 拼音 → 汉字 for a whole sentence.
 *
 * The learner types tone-numbered pinyin (ni3hao3) — that is not a
 * formatting nicety, it is what lets the server keep the tone in the key.
 * Without tones the converter has to guess between 是/识/石, and the old
 * ranking picks 石.
 *
 * The engine label is part of the answer, not decoration: the tone-aware
 * decoder is right on the common sentences and the classic character model
 * gets some of them wrong (我是老师 → 卧石老师). A tool that shows the wrong
 * characters without saying "this may be wrong" teaches the learner to
 * copy mistakes.
 */
export function PinyinFullSentence() {
  const safeMode = useAppStore((s) => s.safeMode);
  const script = useAppStore((s) => s.script);
  const user = useAppStore((s) => s.user);
  const [pinyin, setPinyin] = useState('');
  const [result, setResult] = useState('');
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onConvert = async () => {
    const trimmed = pinyin.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchSentence(trimmed, safeMode, script);
      if (!response.ok) {
        setResult('');
        setEngine(null);
        setError(response.error || '转换失败，请重试');
        return;
      }
      const sentence = response.data.sentence;
      setResult(sentence);
      setEngine(response.data.engine ?? 'classic');
      if (sentence !== '' && user) {
        void createHistoryRequest({
          kind: 'pinyin2text',
          input: trimmed,
          output: sentence,
          char_count: Array.from(sentence).length,
          dedup: true,
        });
      }
    } catch (e) {
      // A network failure must not leave the panel stuck on 「转换中…」.
      setError(`转换失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setPinyin('');
    setResult('');
    setEngine(null);
    setError(null);
  };

  const showsTones = hasTones(pinyin);

  return (
    <div className="space-y-3">
      <label className="block text-sm text-ink-soft">
        输入带声调的拼音
        <input
          value={pinyin}
          onChange={(e) => setPinyin(e.target.value)}
          placeholder="ni3hao3 · wo3shi4lao3shi1"
          className="mt-1 w-full rounded border p-2 focus:outline-none focus:ring-2 focus:ring-seal/30"
        />
      </label>
      <p className="text-xs text-ink-faint">
        用数字标声调：<span className="font-mono">ni3hao3</span> 是“你好”，
        <span className="font-mono">de5</span> 是轻声。带声调时服务器按声调查字，结果更准。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConvert}
          disabled={!pinyin.trim() || loading}
          className="rounded bg-seal px-4 py-1.5 text-sm text-white hover:bg-seal/80 disabled:opacity-50"
        >
          {loading ? '转换中…' : '转换'}
        </button>
        <ReadAloudButton text={result} />
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(result)}
          disabled={!result}
          className="rounded border px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40"
        >
          复制
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded border px-3 py-1.5 text-sm hover:bg-paper-deep"
        >
          清空
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-2">
          <div className="min-h-[2rem] rounded border bg-paper-deep p-2 text-lg">{result}</div>
          {engine === 'tone-aware' ? (
            <p className="text-xs text-ink-faint">
              按声调逐字匹配（你输入的声调直接决定选字），常用句准；词语连写仍可能有偏差。
            </p>
          ) : (
            <p className="text-xs text-amber-700">
              未按声调匹配（输入里没有声调数字，或这句里有用字模型认不出的字），结果可能不准，请核对。
            </p>
          )}
          {!showsTones ? (
            <p className="text-xs text-ink-faint">
              提示：加上声调数字（如 <span className="font-mono">ni3hao3</span>）会得到更准的结果。
            </p>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-ink-faint">转换结果会显示在这里</div>
      )}
    </div>
  );
}
