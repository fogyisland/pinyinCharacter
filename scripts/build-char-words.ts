/**
 * Build the 组词 table — the words a character appears in.
 *
 * ## Why this file exists
 *
 * The dictionary page shows one character at a time: pinyin, radical,
 * meaning, stroke order. A learner in an HSK class studies WORDS, not
 * characters — 「学」 matters because of 学生 and 学习, not because of the
 * glyph. The page had no way to show that.
 *
 * The data was already on disk and unused: `data/bigrams.json` records
 * character pairs from a 47k-phrase corpus, which is enough to say that
 * 学→校 exists but not to print 「学校」 with its reading and its rank.
 *
 * ## Inputs (both public, fetched by this script)
 *
 *   - large_pinyin.txt  word → toned pinyin (413k words, no single chars)
 *   - jieba dict.txt    word → real corpus frequency (349k entries)
 *
 * The pair yields `{ char: [{ word, pinyin, freq }] }`, capped per
 * character: the page shows a short list, not a concordance.
 *
 * ## Sizes measured on this machine
 *
 *   minFreq 500, cap 10 → 2449 chars, 11134 entries, 0.25 MB
 *   minFreq 300, cap  8 → 2979 chars, 12832 entries, 0.29 MB
 *
 * 500/10 is the shipped setting: 学 gets 学生 学院 大学 学校 学习 科学 中学
 * 文学 — which is what a teacher would write on the board.
 *
 * ## Running it
 *
 *     npm run dict:words
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Word → toned pinyin, 413k phrases. */
const PINYIN_URLS = [
  'https://cdn.jsdelivr.net/gh/mozillazg/phrase-pinyin-data@master/large_pinyin.txt',
  'https://fastly.jsdelivr.net/gh/mozillazg/phrase-pinyin-data@master/large_pinyin.txt',
  'https://raw.githubusercontent.com/mozillazg/phrase-pinyin-data/master/large_pinyin.txt',
];

/** Word → real corpus frequency. */
const JIEBA_URLS = [
  'https://cdn.jsdelivr.net/gh/fxsjy/jieba@master/jieba/dict.txt',
  'https://fastly.jsdelivr.net/gh/fxsjy/jieba@master/jieba/dict.txt',
  'https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt',
];

/** Where the table is written. */
const OUTPUT_FILE = join(process.cwd(), 'data', 'char-words.json');

/** One word of a character's list. */
export interface WordEntry {
  word: string;
  pinyin: string;
  freq: number;
}

/** char → its words, most common first. */
export type WordTable = Record<string, WordEntry[]>;

/** The two corpora, already parsed. */
export interface WordSources {
  freqs: Map<string, number>;
  pinyins: Map<string, string>;
}

/** The shortest and longest word that counts as 组词. */
const MIN_WORD_CHARS = 2;
const MAX_WORD_CHARS = 4;

/**
 * Build the per-character word table.
 *
 * Rules, each of which a test pins:
 *
 *   - a word of 1 character is not 组词 (it is the character itself);
 *   - a word of 5+ characters is a phrase, not vocabulary for one char;
 *   - a word whose syllable count does not match its characters is dropped:
 *     printing a wrong reading on the page is worse than printing nothing;
 *   - a word below `minFreq` is too rare to teach;
 *   - each character keeps at most `cap` words, most common first.
 *
 * @param sources the parsed corpora.
 * @param options the frequency floor and the per-character cap.
 * @returns the table.
 */
export function buildWordTable(
  sources: WordSources,
  options: { minFreq: number; cap: number },
): WordTable {
  const { minFreq, cap } = options;
  const buckets = new Map<string, WordEntry[]>();

  for (const [word, pinyin] of sources.pinyins) {
    const freq = sources.freqs.get(word);
    if (freq === undefined || freq < minFreq) continue;
    const chars = Array.from(word);
    if (chars.length < MIN_WORD_CHARS || chars.length > MAX_WORD_CHARS) continue;
    const syllables = pinyin.split(/\s+/);
    // A misaligned corpus line would attach the wrong reading to the word.
    if (syllables.length !== chars.length) continue;
    for (const char of chars) {
      const list = buckets.get(char) ?? [];
      list.push({ word, pinyin, freq });
      buckets.set(char, list);
    }
  }

  const table: WordTable = {};
  for (const [char, list] of buckets) {
    list.sort((a, b) => b.freq - a.freq || a.word.localeCompare(b.word));
    // A word that repeats under the same character (「看看」) must not
    // appear twice in the list.
    const seen = new Set<string>();
    const unique: WordEntry[] = [];
    for (const entry of list) {
      if (seen.has(entry.word)) continue;
      seen.add(entry.word);
      unique.push(entry);
      if (unique.length >= cap) break;
    }
    if (unique.length > 0) table[char] = unique;
  }
  return table;
}

/** Parse jieba's dict into word frequencies. */
export function parseJiebaFrequencies(text: string): Map<string, number> {
  const freqs = new Map<string, number>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const word = parts[0];
    const freq = Number(parts[1]);
    if (!Number.isFinite(freq) || freq <= 0) continue;
    if (freq > (freqs.get(word) ?? 0)) freqs.set(word, freq);
  }
  return freqs;
}

/** Parse the phrase corpus into word → pinyin. */
export function parsePinyinWords(text: string): Map<string, string> {
  const pinyins = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const word = line.slice(0, colon).trim();
    const pinyin = line.slice(colon + 1).trim();
    if (word === '' || pinyin === '') continue;
    if (!pinyins.has(word)) pinyins.set(word, pinyin);
  }
  return pinyins;
}

/**
 * Fetch the first URL that answers, retrying each one.
 *
 * The corpora are 3 MB and 6 MB and the CDN resets large transfers on this
 * link, so mirrors × retries are part of the build, not a nicety.
 */
async function fetchText(urls: readonly string[], attempts = 2): Promise<string> {
  let lastError: unknown = null;
  for (const url of urls) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
        return await res.text();
      } catch (error) {
        lastError = error;
        console.log(`  attempt ${attempt}/${attempts} failed: ${String(error).slice(0, 80)}`);
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }
  throw new Error(`every source failed: ${String(lastError)}`);
}

async function main(): Promise<void> {
  console.log('Fetching jieba frequencies...');
  const jiebaText = await fetchText(JIEBA_URLS);
  const freqs = parseJiebaFrequencies(jiebaText);
  console.log(`  ${freqs.size} word frequencies`);

  console.log('Fetching the phrase-pinyin corpus...');
  const pinyinText = await fetchText(PINYIN_URLS);
  const pinyins = parsePinyinWords(pinyinText);
  console.log(`  ${pinyins.size} words with pinyin`);

  console.log('Building the per-character table...');
  const table = buildWordTable({ freqs, pinyins }, { minFreq: 500, cap: 10 });
  const chars = Object.keys(table).length;
  const entries = Object.values(table).reduce((sum, list) => sum + list.length, 0);
  console.log(`  ${chars} characters, ${entries} entries`);

  const json = JSON.stringify(table);
  writeFileSync(OUTPUT_FILE, json, 'utf-8');
  console.log(`\nWritten to ${OUTPUT_FILE} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);

  for (const char of ['大', '学', '水', '爱', '打', '中']) {
    const list = table[char] ?? [];
    console.log(`  ${char}: ${list.slice(0, 6).map((entry) => entry.word).join(' ')}`);
  }
}

// Run only when this file IS the entry point: a test that imports the
// helpers must not hit the network.
const entry = process.argv[1] ?? '';
if (entry.endsWith('build-char-words.ts') || entry.endsWith('build-char-words.js')) {
  main().catch((error: unknown) => {
    console.error('The word table could not be built:', error);
    process.exitCode = 1;
  });
}
