import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const POEMS_DIR = join(ROOT, 'data', 'poems');
const SOURCE_DIR = join(ROOT, 'data', 'poems-source');
const MANIFEST_PATH = join(ROOT, 'data', 'poems-manifest.json');
const problems: string[] = [];
const notes: string[] = [];

interface CheckedPoem {
  id: number;
  title: string;
  author: string;
  dynasty: string;
  category: string | null;
  content: string[];
  appreciation: string | null;
  variantOf?: number;
}

interface CheckedManifest {
  count: number;
  items: Array<{ id: number; author: string; category: string | null; [key: string]: unknown }>;
  appreciationCount?: number;
  updatedAt?: string;
}

const numericFiles = readdirSync(POEMS_DIR).filter((file) => /^\d+\.json$/.test(file));
const otherFiles = readdirSync(POEMS_DIR).filter((file) => !/^\d+\.json$/.test(file));
const poems = numericFiles.map((file) => JSON.parse(readFileSync(join(POEMS_DIR, file), 'utf8')) as CheckedPoem);
const byId = new Map<number, CheckedPoem>(poems.map((poem) => [poem.id, poem]));

if (poems.length !== 1160) problems.push(`expected 1160 numeric poems, got ${poems.length}`);
if (otherFiles.length !== 0) problems.push(`unexpected non-numeric files in poems/: ${otherFiles.join(', ')}`);

let minLen = Infinity;
let maxLen = 0;
let nonString = 0;
let empty = 0;
let outOfRange = 0;
let noQuote = 0;
let noCjk = 0;
for (const poem of poems) {
  const appreciation = poem.appreciation;
  if (typeof appreciation !== 'string') {
    nonString++;
    continue;
  }
  if (appreciation.length === 0) empty++;
  if (appreciation.length < 60 || appreciation.length > 120) outOfRange++;
  const cjk = (appreciation.match(/[\u3400-\u9fff]/g) ?? []).length;
  if (cjk < 60) noCjk++;
  if (!appreciation.includes('「') || !appreciation.includes('」')) noQuote++;
  minLen = Math.min(minLen, appreciation.length);
  maxLen = Math.max(maxLen, appreciation.length);
}
notes.push(`appreciation: nonString=${nonString} empty=${empty} outOfRange=${outOfRange} cjk<60=${noCjk} quoted=${poems.length - noQuote} min=${minLen} max=${maxLen}`);

// Every quoted fragment must appear (after whitespace normalization) in that poem's content.
let quoteMismatch = 0;
for (const poem of poems) {
  const appreciation = poem.appreciation as string;
  const match = appreciation.match(/「([^」]+)」/);
  if (!match) {
    quoteMismatch++;
    continue;
  }
  const quoted = match[1]!.trim();
  const content = (poem.content as string[]).join('');
  if (!content.includes(quoted)) quoteMismatch++;
}
notes.push(`quote-not-found-in-content: ${quoteMismatch}`);

// Every appreciation must name a concrete craft point.
const CRAFT_TERMS = [
  '对仗', '属对', '两两相对', '用典', '化用', '援古', '铺陈', '铺叙', '多角度摹写',
  '对比', '相互对照', '反衬', '白描', '以简笔勾勒', '质朴无华', '句式参差', '长短句',
  '抑扬顿挫', '音节随情绪', '以动衬静', '静景与动景', '动静', '由实入虚', '实写与想象', '虚实',
  '卒章', '结尾点明', '层层蓄势', '至末句', '借景抒情', '情景交融', '以景语作情语', '融情入景', '炼字',
  '动词选用', '措辞凝练', '声律', '节奏', '意蕴', '起承转合', '以景结情',
];
let noCraft = 0;
for (const poem of poems) {
  const appreciation = poem.appreciation as string;
  if (!CRAFT_TERMS.some((term) => appreciation.includes(term))) noCraft++;
}
notes.push(`appreciation-without-craft-term: ${noCraft}`);

// Distinct appreciation texts (avoid identical boilerplate).
const uniqueAppreciations = new Set(poems.map((poem) => poem.appreciation));
notes.push(`distinct appreciation texts: ${uniqueAppreciations.size} / ${poems.length}`);

// Manifest.
let manifest: CheckedManifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as CheckedManifest;
  notes.push(`manifest: count=${manifest.count} items=${manifest.items.length} appreciationCount=${manifest.appreciationCount} updatedAt=${manifest.updatedAt}`);
  if (manifest.count !== 1160) problems.push(`manifest.count=${manifest.count}`);
  if (manifest.items.length !== 1160) problems.push(`manifest.items=${manifest.items.length}`);
  if (manifest.appreciationCount !== 1160) problems.push(`manifest.appreciationCount=${manifest.appreciationCount}`);
  if (typeof manifest.updatedAt !== 'string') problems.push('manifest.updatedAt missing');
  for (const item of manifest.items) {
    const keys = Object.keys(item).sort();
    const expected = ['author', 'category', 'contentLineCount', 'dynasty', 'form', 'id', 'title'].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected)) {
      problems.push(`manifest item ${item.id} schema changed: ${keys.join(',')}`);
      break;
    }
    const poem = byId.get(item.id);
    if (!poem) problems.push(`manifest id ${item.id} has no poem file`);
    else if (item.author !== poem.author || item.category !== poem.category) problems.push(`manifest/poem mismatch at id ${item.id}`);
  }
} catch (err) {
  problems.push(`manifest parse failed: ${(err as Error).message}`);
}

// Blank authors: only 汉乐府 (1293-1479) and 古诗十九首 (1480-1498) should remain.
const blankAuthors = poems.filter((poem) => !poem.author).map((poem) => poem.id);
const unexpectedBlank = blankAuthors.filter((id) => id < 1293 || id > 1498);
notes.push(`blank authors: ${blankAuthors.length} (unexpected outside 1293-1498: ${unexpectedBlank.join(',') || 'none'})`);
if (unexpectedBlank.length > 0) problems.push(`unexpected blank authors: ${unexpectedBlank.join(',')}`);

// Categories.
const nullCategories = poems.filter((poem) => poem.category == null).map((poem) => poem.id);
const categories: Record<string, number> = {};
for (const poem of poems) categories[String(poem.category)] = (categories[String(poem.category)] ?? 0) + 1;
notes.push(`null categories: ${nullCategories.length}; categories=${JSON.stringify(categories)}`);
if (nullCategories.length !== 0) problems.push(`null categories remain: ${nullCategories.length}`);

// variantOf correctness.
const variantPoems = poems.filter((poem) => poem.variantOf != null);
notes.push(`variantOf markings: ${variantPoems.length}`);
for (const poem of variantPoems) {
  const canonical = byId.get(Number(poem.variantOf));
  if (!canonical) {
    problems.push(`variantOf ${poem.id} -> missing canonical ${poem.variantOf}`);
    continue;
  }
  if (JSON.stringify(poem.content) !== JSON.stringify(canonical.content)) problems.push(`variantOf ${poem.id} -> ${canonical.id} bodies differ`);
  if (poem.id < canonical.id) problems.push(`variantOf ${poem.id} points to later id ${canonical.id}`);
  if (!byId.has(canonical.id)) problems.push(`canonical ${canonical.id} not reachable`);
}

// Raw collection files moved.
const rawNames = ['caocao.json', 'cifu.json', 'nalan.json', 'shijiu.json', 'yuefu.json'];
for (const name of rawNames) {
  if (existsSync(join(POEMS_DIR, name))) problems.push(`${name} still in poems/`);
  if (!existsSync(join(SOURCE_DIR, name))) problems.push(`${name} missing in poems-source/`);
}
notes.push(`raw files moved: ${rawNames.filter((name) => !existsSync(join(POEMS_DIR, name)) && existsSync(join(SOURCE_DIR, name))).length}/5`);

// Sample appreciations for manual review.
const sampleIds = [1, 9, 10, 239, 367, 1499, 1525, 1572, 1746];
const samples: string[] = [];
for (const id of sampleIds) {
  const poem = byId.get(id);
  const appreciation = poem?.appreciation;
  if (poem && appreciation) {
    samples.push(`#${id} ${poem.title} (${poem.dynasty}/${poem.category}/${poem.author})\n${appreciation}\n[len=${appreciation.length}]`);
  }
}

const report = [
  'PROBLEMS: ' + (problems.length === 0 ? 'NONE' : '\n- ' + problems.join('\n- ')),
  '',
  'NOTES:',
  ...notes.map((note) => '- ' + note),
  '',
  'SAMPLES:',
  ...samples,
].join('\n');
writeFileSync(join(ROOT, '.tmp', 'verify-report.txt'), report, 'utf8');
console.log(problems.length === 0 ? 'VERIFY OK' : `VERIFY FAILED (${problems.length})`);
console.log(report.split('\n').slice(0, 16).join('\n'));
