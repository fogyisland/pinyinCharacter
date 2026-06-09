/**
 * Build dictionary JSON files from open-source Chinese data.
 *
 * Input: https://raw.githubusercontent.com/mozillazg/phrase-pinyin-data/master/pinyin.txt
 *   Format: "word: pīn yīn sī yīn" (one word per line, pinyin syllables space-separated after colon,
 *   pinyin uses diacritics: ā á ǎ à a1 a2 a3 a4)
 *
 * Outputs:
 *   - data/pinyin-hanzi.json: pinyin base (no tone, no diacritic) -> [{char, freq}]
 *   - data/bigrams.json:      char -> char -> freq
 *   - data/bad-words.json:    { chars: string[], words: string[] }
 *
 * This is a one-shot script. Re-run only if upgrading dictionary sources.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const SOURCE_URL = 'https://raw.githubusercontent.com/mozillazg/phrase-pinyin-data/master/pinyin.txt';

const SEED_BAD_WORDS = {
  chars: [],
  words: [
    '操你妈', '滚蛋', '妈的', '草泥马',
  ],
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

interface DictEntry { char: string; freq: number; }
type Dict = Record<string, DictEntry[]>;
type Bigrams = Record<string, Record<string, number>>;

/**
 * Strip diacritics from pinyin: "nǐ" -> "ni", "lǜ" -> "lü", "n" -> "n"
 * Also handles ü: "ü" -> "v" for lookup convenience
 */
function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // combining diacritics
    .replace(/ü/g, 'v');       // ü is common in pinyin (nü, lü)
}

function parsePinyinDict(text: string): { dict: Dict; bigrams: Bigrams } {
  const dict: Dict = {};
  const bigrams: Bigrams = {};

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    // Format: "word: pīn yīn sī yīn"
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const word = line.slice(0, colonIdx).trim();
    const pinyinPart = line.slice(colonIdx + 1).trim();
    if (!word || !pinyinPart) continue;

    const syllables = pinyinPart.split(/\s+/);
    if (syllables.length !== word.length) continue;  // skip mismatches

    // Map each (pinyin base) -> char
    for (let i = 0; i < word.length; i++) {
      const ch = word[i]!;
      const basePinyin = stripDiacritics(syllables[i]!);
      if (!basePinyin) continue;
      const arr = (dict[basePinyin] ||= []);
      const existing = arr.find(e => e.char === ch);
      if (existing) existing.freq += 1;
      else arr.push({ char: ch, freq: 1 });
    }

    // Bigrams from this word
    for (let i = 0; i < word.length - 1; i++) {
      const a = word[i]!;
      const b = word[i + 1]!;
      ((bigrams[a] ||= {})[b] ||= 0);
      bigrams[a][b] += 1;
    }
  }

  // Sort each entry by freq desc
  for (const k of Object.keys(dict)) {
    dict[k].sort((x, y) => y.freq - x.freq);
  }
  return { dict, bigrams };
}

async function main() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  console.log('Fetching pypinyin phrase data...');
  const text = await fetchText(SOURCE_URL);
  console.log(`  fetched ${text.length} bytes`);
  console.log('Parsing dictionary...');
  const { dict, bigrams } = parsePinyinDict(text);
  console.log(`  ${Object.keys(dict).length} pinyin keys`);
  console.log(`  ${Object.keys(bigrams).length} char-with-successor keys`);

  writeFileSync(join(DATA_DIR, 'pinyin-hanzi.json'), JSON.stringify(dict));
  writeFileSync(join(DATA_DIR, 'bigrams.json'), JSON.stringify(bigrams));
  writeFileSync(join(DATA_DIR, 'bad-words.json'), JSON.stringify(SEED_BAD_WORDS));

  console.log('Done. Wrote:');
  console.log('  data/pinyin-hanzi.json');
  console.log('  data/bigrams.json');
  console.log('  data/bad-words.json');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
