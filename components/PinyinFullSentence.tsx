'use client';

import { useState } from 'react';
import { fetchSentence } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { ReadAloudButton } from './ReadAloudButton';

export function PinyinFullSentence() {
  const safeMode = useAppStore(s => s.safeMode);
  const script = useAppStore(s => s.script);
  const [pinyin, setPinyin] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const convert = async () => {
    if (!pinyin.trim()) return;
    setLoading(true);
    const res = await fetchSentence(pinyin, safeMode, script);
    setLoading(false);
    if (res.ok) setResult(res.data.sentence);
  };

  const clear = () => {
    setPinyin('');
    setResult('');
  };

  return (
    <div className="space-y-3">
      <input
        value={pinyin}
        onChange={e => setPinyin(e.target.value)}
        placeholder="输入完整带调拼音串 (如: ni3hao3, wo3jiao4xu2peng2)"
        className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={convert}
          disabled={!pinyin || loading}
          className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? '转换中…' : '转换'}
        </button>
        <ReadAloudButton text={result} />
        <button type="button" onClick={() => navigator.clipboard.writeText(result)} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100" disabled={!result}>复制</button>
        <button type="button" onClick={clear} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">清空</button>
      </div>
      {result ? (
        <div className="min-h-[2rem] p-2 bg-gray-50 rounded border text-lg">{result}</div>
      ) : (
        <div className="text-gray-400 text-sm">转换结果会显示在这里</div>
      )}
    </div>
  );
}
