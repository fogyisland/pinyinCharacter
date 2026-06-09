'use client';

import { useMemo, useState } from 'react';
import { textToPinyin } from '@/lib/pinyin-client';
import { PinyinOutput } from './PinyinOutput';
import { ReadAloudButton } from './ReadAloudButton';

export function TextToPinyin() {
  const [text, setText] = useState('');
  const tokens = useMemo(() => textToPinyin(text), [text]);

  return (
    <section className="bg-white border rounded-lg p-4 space-y-3">
      <h2 className="text-base font-semibold">汉字 → 拼音</h2>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="输入或粘贴中文…"
        rows={3}
        className="w-full p-2 border rounded resize-y focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setText('')}
          className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100"
        >
          清空
        </button>
        <ReadAloudButton text={text} />
      </div>
      <PinyinOutput tokens={tokens} />
    </section>
  );
}
