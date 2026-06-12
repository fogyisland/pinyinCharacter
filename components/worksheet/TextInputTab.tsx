'use client';

import { useRef, useState } from 'react';

// 允许的字符集: 常用汉字 + 扩展A 生僻字 + CJK 标点 + 全角符号 (与 lib/validators.ts 一致)
const ALLOWED_CHAR = /[㐀-鿿　-〿＀-￯]/;

interface Props {
  value: string[];
  onChange: (chars: string[]) => void;
}

export function TextInputTab({ value, onChange }: Props) {
  const text = value.join('');
  // IME 拼音输入过程中不能过滤: 每次 onChange 都重设 controlled value 会把 IME 状态打断,
  // 导致后输入的汉字插错位置, 看起来像"字被覆盖"。compositionend 时再统一过滤。
  const [composing, setComposing] = useState(false);
  const rawRef = useRef('');

  const applyFilter = (raw: string) =>
    Array.from(raw).filter((c) => ALLOWED_CHAR.test(c)).slice(0, 500);

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          rawRef.current = e.target.value;
          if (composing) return;
          onChange(applyFilter(e.target.value));
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(e) => {
          setComposing(false);
          rawRef.current = e.currentTarget.value;
          onChange(applyFilter(e.currentTarget.value));
        }}
        placeholder="输入或粘贴汉字,每个字一个格子..."
        rows={8}
        className="w-full rounded-md border border-ink/20 p-3 font-serif text-lg focus:border-seal focus:outline-none"
      />
      <p className="mt-2 text-xs text-ink-faint">
        {value.length} / 500 字
      </p>
    </div>
  );
}
