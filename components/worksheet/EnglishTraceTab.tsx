'use client';

import { useEffect, useState } from 'react';

interface Props {
  value: string[];
  onChange: (chars: string[]) => void;
}

type CaseMode = 'as-is' | 'upper' | 'lower';

const LATIN_ONLY = /[A-Za-z]/g;

// Free-text input + 3-state case toggle (原文 / 全部大写 / 全部小写). We strip
// spaces/punctuation/CJK before splitting into single chars, so each emitted
// entry is exactly one A-Z/a-z letter. The textarea stores the raw input so
// the user's typed text isn't mangled mid-edit; we derive the parsed char
// array on every change and feed it back through onChange.
export function EnglishTraceTab({ value, onChange }: Props) {
  // Internal raw-text state (the textarea's source of truth) — kept in sync
  // with the parsed `value` array on mount and on external value changes.
  const [text, setText] = useState(() => value.join(''));
  const [caseMode, setCaseMode] = useState<CaseMode>('as-is');

  // Keep textarea in sync if parent updates `value` externally (e.g. random
  // picker prefills it, or a "reset" button clears it).
  useEffect(() => {
    setText(value.join(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.join('')]);

  function parseAndEmit(raw: string, mode: CaseMode) {
    const filtered = raw.match(LATIN_ONLY) ?? [];
    const transformed = mode === 'upper' ? filtered.map((c) => c.toUpperCase())
      : mode === 'lower' ? filtered.map((c) => c.toLowerCase())
      : filtered;
    onChange(transformed);
  }

  function handleTextChange(next: string) {
    setText(next);
    parseAndEmit(next, caseMode);
  }

  function handleCaseChange(next: CaseMode) {
    setCaseMode(next);
    parseAndEmit(text, next);
  }

  const charCount = value.length;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="english-input" className="block text-sm font-medium text-ink-soft">
          字母输入 <span className="text-xs text-ink-faint">(只接受 A-Z / a-z,空格和标点自动过滤)</span>
        </label>
        <textarea
          id="english-input"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder="例:HelloWorld,AbCdEf..."
          className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 font-mono text-base"
          rows={4}
        />
        <p className="mt-1 text-xs text-ink-faint">
          已输入 {charCount} 个字母
        </p>
      </div>
      <div>
        <span className="block text-sm font-medium text-ink-soft mb-1">大小写</span>
        <div className="inline-flex rounded-md border border-ink/20 overflow-hidden">
          {(['as-is', 'upper', 'lower'] as CaseMode[]).map((mode) => {
            const label = mode === 'as-is' ? '原文' : mode === 'upper' ? '全部大写' : '全部小写';
            const active = caseMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => handleCaseChange(mode)}
                aria-pressed={active}
                className={`px-3 py-1.5 text-sm ${active ? 'bg-seal text-white' : 'bg-paper text-ink-soft hover:bg-paper-deep'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}