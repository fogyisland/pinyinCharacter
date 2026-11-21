'use client';

import { useState } from 'react';
import type { DictationItem } from '@/lib/dictation';
import {
  parseCustomList,
  annotatePinyin,
  itemsFromHsk,
  itemsFromIdioms,
} from '@/lib/dictation';
import { DictationPaper } from './DictationPaper';

/**
 * The prep form: pick items, edit their pinyin, choose the paper options,
 * preview the blank sheet or the answer page, print.
 *
 * The form is CONTROLLED — the items live with its parent so the dictation
 * runner can share the same batch. The form only ever asks to change them.
 *
 * The teacher is the authority on readings: pinyin fields are editable and
 * 「自动注音」 fills only the empty ones (annotatePinyin never overrides).
 */

interface Props {
  items: DictationItem[];
  onChange: (items: DictationItem[]) => void;
}

/** Where the items come from. */
type Source = 'hsk' | 'idiom' | 'custom';

const HSK_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const IDIOM_LEVELS = [1, 2, 3, 4] as const;

/** A random seed for the UI pickers (the tests pin the seeded API instead). */
function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/**
 * The dictation prep form.
 *
 * @param props the shared items and their setter.
 */
export function DictationPrep({ items, onChange }: Props) {
  const [source, setSource] = useState<Source>('hsk');
  const [hskLevel, setHskLevel] = useState<number>(1);
  const [idiomLevel, setIdiomLevel] = useState<number | ''>('');
  const [count, setCount] = useState<number>(10);
  const [customText, setCustomText] = useState('');
  const [rejected, setRejected] = useState<string[]>([]);
  const [showPinyin, setShowPinyin] = useState(false);
  const [grid, setGrid] = useState<'square' | 'cross'>('square');
  const [preview, setPreview] = useState<'blank' | 'answer'>('blank');
  const [annotating, setAnnotating] = useState(false);

  /** Append picked items, dropping words the batch already has. */
  function addItems(picked: DictationItem[]): void {
    const have = new Set(items.map((i) => i.word));
    const fresh = picked.filter((i) => !have.has(i.word));
    onChange([...items, ...fresh]);
  }

  function handleAddSource(): void {
    if (source === 'hsk') {
      addItems(itemsFromHsk(hskLevel, count, randomSeed()));
    } else if (source === 'idiom') {
      addItems(itemsFromIdioms(idiomLevel === '' ? undefined : idiomLevel, count, randomSeed()));
    } else {
      const parsed = parseCustomList(customText);
      setRejected(parsed.rejected);
      addItems(parsed.items);
    }
  }

  function updatePinyin(index: number, pinyin: string): void {
    onChange(items.map((item, i) => (i === index ? { ...item, pinyin } : item)));
  }

  function removeItem(index: number): void {
    onChange(items.filter((_, i) => i !== index));
  }

  async function handleAutoPinyin(): Promise<void> {
    setAnnotating(true);
    try {
      onChange(await annotatePinyin(items));
    } finally {
      setAnnotating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Source picker */}
      <div className="card-paper space-y-3 p-4">
        <div className="flex gap-2">
          {(
            [
              ['hsk', 'HSK 字表'],
              ['idiom', '成语库'],
              ['custom', '自定义词表'],
            ] as Array<[Source, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSource(key)}
              className={`rounded border px-3 py-1 text-sm ${
                source === key ? 'border-seal bg-seal/10 text-seal' : 'border-ink/20 text-ink-soft'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {source === 'hsk' ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              级别
              <select
                value={hskLevel}
                onChange={(e) => setHskLevel(Number(e.target.value))}
                className="rounded border border-ink/20 bg-paper px-2 py-1"
              >
                {HSK_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    HSK {level}
                  </option>
                ))}
              </select>
            </label>
            <CountField count={count} onChange={setCount} />
          </div>
        ) : source === 'idiom' ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              级别
              <select
                value={idiomLevel}
                onChange={(e) => setIdiomLevel(e.target.value === '' ? '' : Number(e.target.value))}
                className="rounded border border-ink/20 bg-paper px-2 py-1"
              >
                <option value="">全部</option>
                {IDIOM_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    级别 {level}
                  </option>
                ))}
              </select>
            </label>
            <CountField count={count} onChange={setCount} />
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              rows={3}
              placeholder="粘贴课文词表：用逗号、空格或换行分隔，每条 1~4 个字"
              className="w-full rounded border border-ink/20 bg-paper p-2 text-sm"
            />
            {rejected.length > 0 ? (
              <p data-dictation-rejected className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                以下词条超过 4 个字，未加入：{rejected.join('、')}
              </p>
            ) : null}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAddSource}
            className="rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/80"
          >
            加入词条
          </button>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="rounded border border-ink/20 px-3 py-1.5 text-sm text-ink-soft"
            >
              清空
            </button>
          ) : null}
        </div>
      </div>

      {/* Item list editor */}
      {items.length > 0 ? (
        <div className="card-paper space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              词条（{items.length} 条）
            </h2>
            <button
              type="button"
              onClick={handleAutoPinyin}
              disabled={annotating}
              className="rounded border border-ink/20 px-3 py-1 text-xs text-ink-soft hover:bg-paper-deep disabled:opacity-50"
            >
              {annotating ? '注音中…' : '自动注音（只填空白）'}
            </button>
          </div>
          <ul className="space-y-1">
            {items.map((item, index) => (
              <li key={`${item.word}-${index}`} className="flex items-center gap-2 text-sm">
                <span className="w-6 text-right tabular-nums text-ink-faint">{index + 1}</span>
                <span className="w-16">{item.word}</span>
                <input
                  value={item.pinyin}
                  onChange={(e) => updatePinyin(index, e.target.value)}
                  placeholder="拼音（可改）"
                  aria-label={`${item.word} 的拼音`}
                  className="w-40 rounded border border-ink/20 bg-paper px-2 py-0.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  aria-label={`删除 ${item.word}`}
                  className="text-xs text-ink-faint hover:text-seal"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Paper options + preview */}
      <div className="card-paper space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            格子
            <select
              value={grid}
              onChange={(e) => setGrid(e.target.value === 'cross' ? 'cross' : 'square')}
              className="rounded border border-ink/20 bg-paper px-2 py-1"
            >
              <option value="square">田字格</option>
              <option value="cross">米字格</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showPinyin}
              onChange={(e) => setShowPinyin(e.target.checked)}
            />
            答题卷印拼音提示
          </label>
          <div className="flex items-center gap-2">
            {(
              [
                ['blank', '答题卷'],
                ['answer', '答案页'],
              ] as Array<['blank' | 'answer', string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPreview(key)}
                className={`rounded border px-3 py-1 text-sm ${
                  preview === key
                    ? 'border-seal bg-seal/10 text-seal'
                    : 'border-ink/20 text-ink-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={items.length === 0}
            className="ml-auto rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/80 disabled:bg-ink/20"
          >
            打印
          </button>
        </div>

        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="mx-auto max-w-3xl min-w-full sm:min-w-[640px] print:min-w-0">
            <DictationPaper
              items={items}
              mode={preview}
              showPinyin={showPinyin}
              grid={grid}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The "how many items" field shared by the HSK and idiom sources. */
function CountField({ count, onChange }: { count: number; onChange: (count: number) => void }) {
  return (
    <label className="flex items-center gap-2">
      条数
      <input
        type="number"
        min={1}
        max={100}
        value={count}
        onChange={(e) => onChange(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
        className="w-20 rounded border border-ink/20 bg-paper px-2 py-1"
      />
    </label>
  );
}
