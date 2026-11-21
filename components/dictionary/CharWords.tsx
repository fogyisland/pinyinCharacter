'use client';

import Link from 'next/link';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import type { WordEntry } from '@/lib/char-words';

/**
 * 组词 — the words a character appears in.
 *
 * A learner studies WORDS, not characters: 「学」 matters because of 学生 and
 * 学习. Each word is shown with its reading, spoken aloud on demand, and
 * linked straight into the worksheet tool so the learner can practise it.
 *
 * The section renders NOTHING when the character has no words at the
 * shipped frequency floor: an empty 「组词 ·」 heading looks like a bug.
 */
export interface CharWordsProps {
  /** The character this section belongs to. */
  char: string;
  /** Its words, most common first. */
  words: WordEntry[];
}

/**
 * The 组词 section.
 *
 * @param props the character and its words.
 */
export function CharWords({ char, words }: CharWordsProps) {
  if (words.length === 0) return null;

  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm text-ink-soft">组词 · {words.length}</h3>
      <ul className="space-y-1.5">
        {words.map((entry) => (
          <li key={entry.word} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-kai text-lg leading-snug text-ink">{entry.word}</span>
            <span className="text-xs text-ink-faint">{entry.pinyin}</span>
            <ReadAloudButton text={entry.word} label="读" size="sm" variant="paper" />
            <Link
              href={`/worksheet?prefill=${encodeURIComponent(entry.word)}`}
              className="text-xs text-seal hover:underline"
            >
              练这个词 →
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-faint">
        这些词里都有「{char}」，按常用程度排列。
      </p>
    </section>
  );
}
