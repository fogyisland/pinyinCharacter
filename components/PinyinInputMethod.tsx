'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchCandidates, type Candidate } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { ReadAloudButton } from './ReadAloudButton';

export function PinyinInputMethod() {
  const safeMode = useAppStore(s => s.safeMode);
  const script = useAppStore(s => s.script);
  const [buffer, setBuffer] = useState('');
  const [committed, setCommitted] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced candidate fetch
  useEffect(() => {
    if (!buffer) {
      setCandidates([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetchCandidates(buffer, safeMode, script);
      if (res.ok) setCandidates(res.data.candidates);
    }, 80);
    return () => clearTimeout(timer);
  }, [buffer, safeMode, script]);

  const pick = (i: number) => {
    const c = candidates[i];
    if (!c) return;
    setCommitted(prev => prev + c.char);
    setBuffer('');
    setCandidates([]);
    inputRef.current?.focus();
  };

  const backspace = () => {
    if (buffer) {
      setBuffer(b => b.slice(0, -1));
    } else if (committed) {
      setCommitted(c => c.slice(0, -1));
    }
  };

  const clear = () => {
    setBuffer('');
    setCommitted('');
    setCandidates([]);
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        value={buffer}
        onChange={e => {
          // Accept only letters, digits, apostrophe
          const v = e.target.value.replace(/[^a-zA-Z1-5']/g, '');
          setBuffer(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace') {
            e.preventDefault();
            backspace();
            return;
          }
          if (e.key === ' ') {
            e.preventDefault();
            pick(0);
            return;
          }
          if (/^[1-9]$/.test(e.key)) {
            e.preventDefault();
            const idx = parseInt(e.key, 10) - 1;
            pick(idx);
            return;
          }
        }}
        placeholder="输入拼音 (如: nihao 或 ni3hao3)"
        className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      <div className="min-h-[2rem] p-2 bg-gray-50 rounded border text-lg">
        {committed}
        {buffer && <span className="text-blue-500 ml-1">|{buffer}</span>}
        {!committed && !buffer && <span className="text-gray-400 text-sm">在上方输入拼音，选择候选字</span>}
      </div>
      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {candidates.slice(0, 9).map((c, i) => (
            <button
              key={c.char + i}
              type="button"
              onClick={() => pick(i)}
              className="px-3 py-1 border rounded hover:bg-blue-50 text-base"
            >
              <span className="text-gray-400 mr-1 text-xs">{i + 1}</span>
              {c.char}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <ReadAloudButton text={committed} label="🔊 朗读" />
        <button type="button" onClick={() => navigator.clipboard.writeText(committed)} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100" disabled={!committed}>复制</button>
        <button type="button" onClick={clear} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">清空</button>
      </div>
    </div>
  );
}
