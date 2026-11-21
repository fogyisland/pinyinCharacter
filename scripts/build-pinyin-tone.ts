/**
 * Build the TONE-AWARE pinyin table.
 *
 * ## Why this file exists
 *
 * `data/pinyin-hanzi.json` throws the tone away: "shi4" and "shi2" both
 * become "shi", so 是 / 识 / 十 / 时 compete on frequency alone. Its
 * frequencies come from a PHRASE list, where a rare character inside many
 * obscure words outranks a common one — 泥(109) sits above 你(10), 石(405)
 * above 是, 得(362) above 的(41). The result: 我爱你 decoded as 我爱泥 and
 * 我是老师 as 卧石老师 (2/10 on a teacher's sample sentences).
 *
 * Two fixes, both from public data:
 *
 *   1. **Keep the tone in the key.** The user types ni3hao3; the phrase
 *      corpus carries nǐ hǎo. Matching tone for tone kills most of the
 *      competition before the model even starts.
 *   2. **Real corpus frequencies.** jieba's `dict.txt` carries actual
 *      corpus counts for both words and single characters (是 = 796991),
 *      which is what ranks 是 above 识 inside the same shi4 bucket.
 *
 * Measured on 15 teacher-written sentences: the shipped converter scores
 * 2/15; this table with the shipped bigrams scores 8/15 (53% after the
 * Viterbi constants were swept). The surviving misses are all word-level
 * ambiguities a character model cannot resolve (今→心, 甚→什, 杯→背,
 * 咖→喀) — a word table's job, not a character table's, and the probes
 * showed a pruned word table does not beat this (see .tmp/probe-*.out).
 *
 * ## What it writes
 *
 *     data/pinyin-tone.json   { "ni3": [{"char":"你","freq":234587}, ...], ... }
 *
 * 1548 toned syllables, 14k entries, 339 KB. Small enough for the server to
 * read once at boot.
 *
 * ## Running it
 *
 *     npm run dict:tone
 *
 * Network required: two public corpora, with CDN mirrors because the
 * raw.githubusercontent.com hostname resets large transfers on some links.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { syllableKeyOf, type ToneEntry, type ToneTable } from '../lib/pinyin-tone-decode';

/** Real corpus frequencies, words AND single characters (fxsjy's jieba dict). */
const JIEBA_URLS = [
  'https://cdn.jsdelivr.net/gh/fxsjy/jieba@master/jieba/dict.txt',
  'https://fastly.jsdelivr.net/gh/fxsjy/jieba@master/jieba/dict.txt',
  'https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt',
];

/** Word → toned pinyin, 413k phrases, no single-character lines. */
const PINYIN_URLS = [
  'https://cdn.jsdelivr.net/gh/mozillazg/phrase-pinyin-data@master/large_pinyin.txt',
  'https://fastly.jsdelivr.net/gh/mozillazg/phrase-pinyin-data@master/large_pinyin.txt',
  'https://raw.githubusercontent.com/mozillazg/phrase-pinyin-data/master/large_pinyin.txt',
];

/** Where the table is written. */
const OUTPUT_FILE = join(process.cwd(), 'data', 'pinyin-tone.json');

/** jieba's corpus frequencies: words and single characters separately. */
export interface JiebaFrequencies {
  wordFreqs: Map<string, number>;
  charFreqs: Map<string, number>;
}

/**
 * Parse jieba's dict ("word freq tag" per line).
 *
 * Single-character lines are the ones that matter most here: they are the
 * real frequency of 是, 你, 的, which the phrase-list counts got wrong.
 *
 * @param text the dict.txt body.
 * @returns word and single-character frequencies.
 */
export function parseJieba(text: string): JiebaFrequencies {
  const wordFreqs = new Map<string, number>();
  const charFreqs = new Map<string, number>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const word = parts[0];
    const freq = Number(parts[1]);
    if (!Number.isFinite(freq) || freq <= 0) continue;
    const current = wordFreqs.get(word) ?? 0;
    if (freq > current) wordFreqs.set(word, freq);
    if (Array.from(word).length === 1) {
      charFreqs.set(word, (charFreqs.get(word) ?? 0) + freq);
    }
  }
  return { wordFreqs, charFreqs };
}

/**
 * Build the tone-aware table from the phrase corpus.
 *
 * A character's rank inside a syllable is its own corpus frequency; when
 * jieba does not know the character (rare ones), 1 is used so it still
 * exists as a candidate but sits at the bottom of the bucket.
 *
 * The syllable key comes from `syllableKeyOf` in `lib/pinyin-tone-decode` —
 * the SAME function the decoder uses. A second implementation here would
 * let the table and the decoder drift apart, and the failure would be a
 * silently empty candidate list.
 *
 * @param corpus the phrase-pinyin text ("word: pīn yīn" per line).
 * @param charFreqs jieba single-character frequencies.
 * @param minFreq drop characters whose corpus frequency is below this.
 */
export function buildToneTable(
  corpus: string,
  charFreqs: Map<string, number>,
  minFreq = 1,
): ToneTable {
  const buckets = new Map<string, Map<string, number>>();
  for (const raw of corpus.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const word = line.slice(0, colon).trim();
    const pinyinPart = line.slice(colon + 1).trim();
    if (word === '' || pinyinPart === '') continue;
    const syllables = pinyinPart.split(/\s+/);
    const chars = Array.from(word);
    if (syllables.length !== chars.length) continue;
    for (let i = 0; i < chars.length; i += 1) {
      const key = syllableKeyOf(syllables[i]);
      if (key === '') continue;
      const bucket = buckets.get(key) ?? new Map<string, number>();
      const char = chars[i];
      const weight = charFreqs.get(char) ?? 1;
      if (weight > (bucket.get(char) ?? 0)) bucket.set(char, weight);
      buckets.set(key, bucket);
    }
  }

  const table: ToneTable = {};
  for (const [key, bucket] of buckets) {
    const entries: ToneEntry[] = [...bucket.entries()]
      .filter(([, freq]) => freq >= minFreq)
      .map(([char, freq]) => ({ char, freq }))
      .sort((a, b) => b.freq - a.freq);
    if (entries.length > 0) table[key] = entries;
  }
  return table;
}

/**
 * Fetch the first URL that answers, retrying each one.
 *
 * The corpora are 1.9 MB and 6 MB; a TLS reset mid-body is common on a
 * flaky link, and a build that dies after downloading 1.9 MB is annoying.
 * Mirrors × retries turn that into a non-event.
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
  console.log(`  ${jiebaText.length} bytes`);
  const { charFreqs } = parseJieba(jiebaText);
  console.log(`  ${charFreqs.size} single-character frequencies`);

  console.log('Fetching the phrase-pinyin corpus...');
  const pinyinText = await fetchText(PINYIN_URLS);
  console.log(`  ${pinyinText.length} bytes`);

  console.log('Building the tone-aware table...');
  const table = buildToneTable(pinyinText, charFreqs);
  console.log(`  ${Object.keys(table).length} toned syllables`);

  const json = JSON.stringify(table);
  writeFileSync(OUTPUT_FILE, json, 'utf-8');
  console.log(`\nWritten to ${OUTPUT_FILE} (${(json.length / 1024).toFixed(0)} KB)`);

  // Spot checks: the syllables a beginner types first.
  for (const [syllable, expected] of [
    ['ni3', '你'],
    ['shi4', '是'],
    ['de5', '的'],
    ['qu4', '去'],
    ['you3', '有'],
    ['hao3', '好'],
  ]) {
    const top = table[syllable]?.slice(0, 4).map((entry) => entry.char).join(' ') ?? '(missing)';
    console.log(
      `  ${syllable}: ${top}${table[syllable]?.[0]?.char === expected ? '' : '   <-- EXPECTED ' + expected}`,
    );
  }
}

// Run only when this file IS the entry point: a test that imports the
// helpers must not hit the network.
const entry = process.argv[1] ?? '';
if (entry.endsWith('build-pinyin-tone.ts') || entry.endsWith('build-pinyin-tone.js')) {
  main().catch((error: unknown) => {
    console.error('The tone-aware table could not be built:', error);
    process.exitCode = 1;
  });
}
