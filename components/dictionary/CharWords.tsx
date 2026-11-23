'use client';

import Link from 'next/link';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import type { WordEntry } from '@/lib/char-words';
import type { ExampleEntry } from '@/lib/char-examples';

/**
 * 组词 — the words a character appears in, each with an example sentence.
 *
 * A learner studies WORDS, not characters: 「学」 matters because of 学生 and
 * 学习. And a word alone is a label — 「学生」 means little until it is used:
 * 「你是学生吗？」. So each word carries its reading, a sentence pair, a
 * read-aloud button and a link into the worksheet tool.
 *
 * The section renders NOTHING when the character has no words at the
 * shipped frequency floor: an empty 「组词 ·」 heading looks like a bug.
 *
 * The examples are looked up here rather than passed per word: they come
 * from a table the caller already has, and a word without a sentence simply
 * gets no sentence — the build covers 61% of the words, and the rest must
 * not leave an empty gap.
 */
export interface CharWordsProps {
  /** The character this section belongs to. */
  char: string;
  /** Its words, most common first. */
  words: WordEntry[];
  /**
   * word → its example sentences. Resolved on the server (the table is
   * 691 KB) and handed in as props, so the client never imports the reader.
   */
  examples?: Record<string, ExampleEntry[]>;
}

/**
 * The 组词 section.
 *
 * @param props the character, its words and the example table.
 */
export function CharWords({ char, words, examples = {} }: CharWordsProps) {
  if (words.length === 0) return null;

  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm text-ink-soft">组词 · {words.length}</h3>
      <ul className="space-y-3">
        {words.map((entry) => {
          const sentences = examples[entry.word] ?? [];
          return (
            <li key={entry.word}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-kai text-lg leading-snug text-ink">{entry.word}</span>
                <span className="text-xs text-ink-faint">{entry.pinyin}</span>
                <ReadAloudButton text={entry.word} label="读" size="sm" variant="paper" />
                <Link
                  href={`/worksheet?prefill=${encodeURIComponent(entry.word)}`}
                  className="text-xs text-seal hover:underline"
                >
                  练这个词 →
                </Link>
              </div>
              {sentences.length > 0 ? (
                <ul className="mt-1 space-y-1 pl-1">
                  {sentences.map((sentence) => (
                    <li key={sentence.zh} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm text-ink">{sentence.zh}</span>
                      <span className="text-xs text-ink-faint">{sentence.en}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-ink-faint">
        这些词里都有「{char}」，按常用程度排列。
      </p>
    </section>
  );
}
