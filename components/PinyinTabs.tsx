'use client';

import { useState } from 'react';
import { TextToPinyin } from './TextToPinyin';
import { PinyinInputMethod } from './PinyinInputMethod';
import { PinyinFullSentence } from './PinyinFullSentence';

/**
 * The three panels of /pinyin.
 *
 * The page said 「字 ⇄ 拼音 互转」 and converted one way only: the two
 * 拼音 → 汉字 components existed but nothing mounted them. A learner who
 * needs to type a character from its sound (homework, chat, writing
 * practice) had no way to do it here.
 *
 * Both directions now sit side by side, flat, like the game page's panels.
 */

/** Which panel is open. */
type Tab = 'text' | 'input' | 'sentence';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'text', label: '字 → 拼音' },
  { id: 'input', label: '拼音 → 字' },
  { id: 'sentence', label: '整句转汉字' },
];

/**
 * The pinyin tool's tabs.
 */
export function PinyinTabs() {
  const [tab, setTab] = useState<Tab>('text');

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="拼音工具" className="flex gap-1 border-b border-ink/10 pb-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={`rounded-sm px-3 py-1.5 text-sm ${
              tab === entry.id
                ? 'border-b-2 border-seal font-medium text-seal'
                : 'text-ink-faint hover:text-ink'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'text' ? <TextToPinyin /> : null}
      {tab === 'input' ? (
        <section className="card-paper space-y-3 p-4">
          <div>
            <h2 className="text-base font-semibold">拼音 → 字</h2>
            <p className="mt-1 text-xs text-ink-soft">
              输入拼音（如 <span className="font-mono">ni3</span> 或
              <span className="font-mono"> ni3hao3</span>），从候选里点选汉字；数字键或空格选第一个。
            </p>
          </div>
          <PinyinInputMethod />
        </section>
      ) : null}
      {tab === 'sentence' ? (
        <section className="card-paper space-y-3 p-4">
          <div>
            <h2 className="text-base font-semibold">整句转汉字</h2>
            <p className="mt-1 text-xs text-ink-soft">
              一整句拼音一次转成汉字。带声调数字时按声调逐字匹配，结果更准。
            </p>
          </div>
          <PinyinFullSentence />
        </section>
      ) : null}
    </div>
  );
}
