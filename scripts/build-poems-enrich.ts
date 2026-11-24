/**
 * Backfill poem metadata and generate poem-specific Chinese appreciations.
 *
 * Reads every numeric data/poems/<id>.json, then:
 *   1. fills `appreciation` (60–120 chars) for every poem that has none,
 *   2. fills `author` for the 47 anonymous 骈文/赋 pieces (ids 1499–1545),
 *   3. fills `category` for poems whose category is null (诗 / 词),
 *   4. marks byte-identical duplicate bodies with `variantOf: <canonical id>`,
 *   5. moves the 5 raw collection files out of the loader directory,
 *   6. adds `appreciationCount` + refreshes `updatedAt` in the manifest.
 *
 * Idempotent: appreciations/authors/categories/variantOf are only written when
 * absent, so re-running never overwrites manual edits. Run with:
 *   npx tsx scripts/build-poems-enrich.ts
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const POEMS_DIR = join(ROOT, 'data', 'poems');
const SOURCE_DIR = join(ROOT, 'data', 'poems-source');
const MANIFEST_PATH = join(ROOT, 'data', 'poems-manifest.json');
const RAW_FILES = ['caocao.json', 'cifu.json', 'nalan.json', 'shijiu.json', 'yuefu.json'];

/** Only the 47 pianwen/cifu pieces get an author; 汉乐府 / 古诗十九首 stay anonymous. */
const CIFU_AUTHORS: Record<number, string> = {
  1499: '王勃',
  1500: '杜牧',
  1501: '范仲淹',
  1502: '苏轼',
  1503: '欧阳修',
  1504: '曾巩',
  1505: '宋玉',
  1506: '宋玉',
  1507: '宋玉',
  1508: '枚乘',
  1509: '赵壹',
  1510: '贾谊',
  1511: '贾谊',
  1512: '刘彻',
  1513: '东方朔',
  1514: '王褒',
  1515: '班彪',
  1516: '班昭',
  1517: '班固',
  1518: '班固',
  1519: '扬雄',
  1520: '扬雄',
  1521: '张衡',
  1522: '蔡邕',
  1523: '祢衡',
  1524: '王粲',
  1525: '曹植',
  1526: '向秀',
  1527: '张载',
  1528: '谢庄',
  1529: '谢惠连',
  1530: '鲍照',
  1531: '江淹',
  1532: '庾信',
  1533: '韩愈',
  1534: '柳宗元',
  1535: '柳宗元',
  1536: '白居易',
  1537: '苏舜钦',
  1538: '欧阳修',
  1539: '黄庭坚',
  1540: '姚鼐',
  1541: '方孝孺',
  1542: '袁宏道',
  1543: '黄宗羲',
  1544: '袁枚',
  1545: '沈德潜',
};

type Theme = '边塞' | '山水' | '月夜' | '春' | '秋' | '愁思' | '酒宴' | '田园' | '闺怨' | '咏物' | '怀古' | 'default';
type Craft = '对偶' | '用典' | '铺陈' | '对比' | '白描' | '节奏' | '动静' | '虚实' | '卒章' | '借景' | '炼字';

interface Poem {
  id: number;
  title: string;
  author: string;
  dynasty: string;
  category: string | null;
  form: string | null;
  content: string[];
  pinyin: string[][];
  appreciation: string | null;
  source?: string;
  variantOf?: number;
  [key: string]: unknown;
}

interface ManifestItem {
  id: number;
  title: string;
  author: string;
  dynasty: string;
  category: string | null;
  form: string | null;
  contentLineCount: number;
  [key: string]: unknown;
}

const THEME_KEYWORDS: Array<[Theme, string[]]> = [
  ['边塞', ['关山', '塞', '胡', '羌', '戍', '征', '战', '兵', '剑', '戈', '长城', '玉门', '阳关', '匈奴', '边', '将军', '营', '旗', '鼓', '角']],
  ['闺怨', ['宫', '帘', '妆', '眉', '妾', '玉阶', '罗', '裙', '闺', '姝', '娉', '婵娟']],
  ['田园', ['田园', '田家', '归园', '归田', '隐', '桑', '渔', '樵', '篱', '禾', '农', '村', '园田']],
  ['咏物', ['蝉', '梅', '兰', '竹', '松', '莲', '鹤', '萤', '蜘蛛', '桐', '鸥', '鹭', '蜂', '蝶', '牡丹', '菊']],
  ['怀古', ['兴亡', '荒', '废', '陵', '遗迹', '故国', '荒城', '废墟', '昔时', '当年', '千古', '陈迹']],
  ['酒宴', ['酒', '醉', '樽', '杯', '宴', '饮', '觞', '醪', '酹', '酣']],
  ['月夜', ['月', '夜', '星', '露', '灯', '烛', '宵', '夕', '银河', '砧']],
  ['秋', ['秋', '霜', '雁', '枫', '落叶', '寒', '暮', '夕阳', '萧萧']],
  ['春', ['春', '花', '柳', '莺', '燕', '东风', '桃', '李', '芳', '絮']],
  ['山水', ['山', '岭', '峰', '江', '河', '湖', '海', '岳', '登', '望', '川', '谷', '溪', '泉', '峦']],
  ['愁思', ['愁', '思', '忆', '别', '离', '泪', '恨', '怨', '孤', '独', '客', '乡', '归', '梦', '怅']],
];

const ALLUSION_WORDS = [
  '庄生', '望帝', '冯唐', '李广', '贾谊', '屈原', '汨罗', '桃源', '伯牙', '钟期', '兰亭', '梓泽',
  '周郎', '赤壁', '谢安', '东山', '张翰', '苏武', '班超', '投笔', '请缨', '终军', '宗悫', '涸辙',
  '东隅', '桑榆', '贪泉', '阮籍', '穷途', '孟尝', '梁鸿', '徐孺', '陈蕃', '鲲鹏', '鹏', '彭泽',
  '邺水', '临川', '潘江', '陆海', '龙门', '鲤对', '弱冠', '杨意', '凌云', '流水', '高山', '贾生',
];

const CONTRAST_RE = /昔|今|新|旧|贵|贱|明|暗|高|低|有无|聚散|悲欢|盛衰|荣枯|来去|生死|老少|多少|盈虚|彼此|晓暮|朝暮/;

const OPENERS: Record<string, string[]> = {
  tang: [
    '这首{form}气韵连贯，格调清远。',
    '此诗笔致疏朗，写景尤见功力。',
    '诗人以简练笔墨，写出开阔意境。',
    '这首{form}起承转合，自有章法。',
  ],
  song: [
    '这首词笔致婉转，音节谐婉。',
    '词中以景写情，层层递进。',
    '此词短章深意，读来低回。',
    '词笔细腻，于寻常景物中见幽怀。',
  ],
  清: [
    '这首词清丽深婉，别有会心。',
    '词笔细腻，于短章中见深情。',
    '此阕语淡情浓，耐人寻味。',
  ],
  汉: [
    '这首乐府质朴自然，真挚动人。',
    '歌辞不事雕琢，自有力量。',
    '此篇以白描取胜，气息古朴。',
  ],
  汉末: [
    '此诗语浅情深，得古诗本色。',
    '《古诗十九首》含蓄蕴藉，耐人寻味。',
    '这首五言古诗平平道来，却自感人。',
  ],
  三国: [
    '这首诗慷慨沉雄，风骨凛然。',
    '建安歌辞气势充沛，感人至深。',
    '此篇以气驭辞，格调高远。',
  ],
  mixed: [
    '这篇{genre}辞采斐然，铺陈有致。',
    '此文骈散相济，情理兼备。',
    '作者以华美文辞，抒写胸中块垒。',
    '通篇对偶精工，而气脉流转。',
  ],
};

const THEME_PHRASES: Record<Theme, string[]> = {
  边塞: [
    '写边关苍茫之景，豪情与悲慨交织于笔端',
    '描摹塞外风物，慷慨之中隐含几许苍凉',
    '以简劲之笔写征戍生活，气骨凛然',
  ],
  山水: [
    '写登高望远之所见，境界顿开，气象万千',
    '描绘山川形胜，景象阔大，令人神往',
    '摄取远景入诗，境界开阔而意蕴悠长',
  ],
  月夜: [
    '写月夜清辉，幽寂之中透出孤怀',
    '以月色烘托心境，清冷而动人',
    '描摹夜色空明，情思于无声处流转',
  ],
  春: [
    '写春日风物，生机盎然，明丽可喜',
    '以清新笔调描摹春景，灵动自然',
    '撷取春意入句，字里行间透出欢欣',
  ],
  秋: [
    '写秋气萧瑟，愁绪于字里行间暗生',
    '以秋景衬离怀，萧索中自见深情',
    '摹写霜气林木，清冷而萧疏',
  ],
  愁思: [
    '抒离愁别绪，语淡而情浓，余味不尽',
    '写羁旅之思，婉转深沉，令人低回',
    '以寻常语道尽心中怅惘，真切动人',
  ],
  酒宴: [
    '写宴饮之欢，豪气跃然纸上',
    '借酒抒怀，情致淋漓，尽显性情',
    '写樽前光景，酣畅之中自有感慨',
  ],
  田园: [
    '写田园闲适，恬淡自足，气息清新',
    '描摹乡居情景，质朴而亲切',
    '以淡笔写静景，见出悠然之心',
  ],
  闺怨: [
    '写闺中幽思，含蓄婉转，情致细腻',
    '以景物映衬孤怀，幽怨而不直露',
    '摹写幽居寂寞，语柔而意深',
  ],
  咏物: [
    '托物寄意，物我交融，寄托遥深',
    '咏物而抒怀，借物象写胸中情怀',
    '以物喻志，含蓄有致，耐人寻味',
  ],
  怀古: [
    '抚今追昔，兴亡之感顿生笔端',
    '借古迹抒怀，感慨深沉而悠远',
    '以昔衬今，盛衰之变大有深意',
  ],
  default: [
    '勾勒眼前景物，情景交融，自然真切',
    '以景起兴，平实中自见情致',
    '描摹所见，灵动如画，意趣盎然',
  ],
};

const CRAFT_PHRASES: Record<Craft, string[]> = {
  对偶: [
    '对仗工整，两句相映成趣，尽显声律之美',
    '属对精切，富有形式之美与节奏之感',
    '上下句两两相对，读来匀称而和谐',
  ],
  用典: [
    '用典贴切，借古人之事抒一己之怀',
    '化用故实，含蓄而意蕴丰厚',
    '援古证今，拓展了作品的表达深度',
  ],
  铺陈: [
    '铺陈排比，层层推进，气势充沛',
    '反复铺叙，穷形尽相，极尽描摹之能事',
    '多角度摹写，由远及近，秩序井然',
  ],
  对比: [
    '对比鲜明，两相映衬而意旨愈显',
    '前后境况相互对照，反差强烈',
    '巧用反衬手法，突出了全篇主旨',
  ],
  白描: [
    '白描传神，不事雕琢而情态毕现',
    '以简笔勾勒，形象生动，如在目前',
    '语言质朴无华，却自有一种动人力量',
  ],
  节奏: [
    '句式参差，节奏跌宕而富有张力',
    '长短句交错，读来抑扬顿挫',
    '音节随情绪起伏，摇曳生姿',
  ],
  动静: [
    '动静相生，画面顿然鲜活起来',
    '以动衬静，境界愈显幽深',
    '静景与动景交织，生气流转其间',
  ],
  虚实: [
    '虚实相映，拓展了想象的余裕',
    '实写与想象交织，意境更为开阔',
    '由实入虚，使情思显得深长',
  ],
  卒章: [
    '卒章显志，收束有力，余韵悠长',
    '结尾点明主旨，与开篇遥相呼应',
    '层层蓄势，至末句而情毕露',
  ],
  借景: [
    '借景抒情，景中含情，意在言外',
    '情景交融，以景语作情语，含蓄蕴藉',
    '融情入景，使寻常风物皆着情绪',
  ],
  炼字: [
    '炼字精准，一字落下而全句生辉',
    '动词选用尤妙，使画面顿然活化',
    '措辞凝练，极富表现力',
  ],
};

const CLOSINGS: Record<string, string[]> = {
  tang: [
    '全诗以景结情，余韵悠长。',
    '章法井然，情致婉转，读之令人回味。',
    '一气呵成，意境浑成。',
    '语言凝练而意味深长。',
  ],
  song: [
    '词境幽微，读之令人低回。',
    '婉转中见沉郁，耐人寻味。',
    '以景收束，余情袅袅。',
    '声情并茂，尽显词体之美。',
  ],
  清: [
    '语淡情深，自成高格。',
    '于短章中见深致，余味不尽。',
    '清丽之中寓有沉郁，动人心弦。',
  ],
  汉: [
    '语言质朴，自有动人之处。',
    '以事抒情，真挚感人。',
    '直抒胸臆，是乐府本色。',
  ],
  汉末: [
    '浅语深情，余味无穷。',
    '含蓄蕴藉，正是古诗本色。',
  ],
  三国: [
    '慷慨悲凉，风骨凛然。',
    '气势充沛，读之令人振奋。',
  ],
  mixed: [
    '文辞华美而情理兼备。',
    '铺陈之中自有骨力，非徒辞采而已。',
    '骈俪之体，兼得辞采与情思。',
  ],
};

const FILLERS = [
  '细细品之，别有一番滋味。',
  '读来令人回味再三。',
  '短章之中，意致悠然。',
  '余音袅袅，不绝如缕。',
];

/** Deterministic PRNG so regenerations produce identical text. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  if (items.length === 0) throw new Error('pick: empty pool');
  return items[Math.floor(random() * items.length)] as T;
}

function countCjk(text: string): number {
  return (text.match(/[\u3400-\u9fff]/g) ?? []).length;
}

/** Strip the "（某某 一作：……）" textual variants appended by the source. */
function cleanLine(line: string): string {
  return line
    .replace(/[（(][^）)]*一作[^）)]*[）)]/g, '')
    .replace(/[（(][^）)]*作[：:][^）)]*[）)]/g, '')
    .trim();
}

function detectTheme(content: string, title: string): Theme {
  const haystack = `${title} ${content}`;
  let best: Theme = 'default';
  let bestScore = 0;
  for (const [theme, words] of THEME_KEYWORDS) {
    let score = 0;
    for (const word of words) {
      if (haystack.includes(word)) score += word.length > 1 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = theme;
    }
  }
  return best;
}

function detectCrafts(poem: Poem, content: string, random: () => number): [Craft, Craft] {
  const candidates: Craft[] = [];
  const form = String(poem.form ?? '');
  const title = String(poem.title ?? '');
  if (form.includes('律')) candidates.push('对偶', '对偶', '炼字');
  if (poem.dynasty === 'mixed' || /赋|文|序|记|铭|说|箴|对$/.test(title)) candidates.push('铺陈', '铺陈', '用典');
  if (ALLUSION_WORDS.some((word) => content.includes(word))) candidates.push('用典', '用典');
  if (CONTRAST_RE.test(content)) candidates.push('对比');
  if (form.includes('古风')) candidates.push('节奏', '白描', '节奏');
  candidates.push('借景', '借景', '动静', '虚实');
  if (poem.dynasty === 'song' || poem.dynasty === '清') candidates.push('卒章', '炼字');

  const primary = pick(candidates, random);
  const others = candidates.filter((craft) => craft !== primary);
  const secondary = others.length > 0 ? pick(others, random) : primary;
  return [primary, secondary];
}

function chooseClause(lines: string[], theme: Theme, random: () => number): string {
  const themeWords = THEME_KEYWORDS.find(([key]) => key === theme)?.[1] ?? [];
  const candidates: Array<{ text: string; score: number }> = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const cleaned = cleanLine(lines[lineIndex] ?? '');
    const clauses = cleaned.split(/[，。；？！、：,.!?;]/);
    for (const raw of clauses) {
      const clause = raw.trim();
      if (clause.length < 4 || clause.length > 16) continue;
      if (countCjk(clause) < 4) continue;
      const hit = themeWords.reduce((sum, word) => sum + (clause.includes(word) ? 1 : 0), 0);
      const score = hit * 4 + (clause.length >= 6 && clause.length <= 12 ? 2 : 0) + (lineIndex === 0 ? 1 : 0) + random() * 3;
      candidates.push({ text: clause, score });
    }
  }
  if (candidates.length === 0) {
    // Very short clauses (e.g. 汉乐府 "太一况，天马下") must still be quoted
    // verbatim, so fall back to the first original clause rather than
    // concatenating across punctuation.
    for (const raw of cleanLine(lines[0] ?? '').split(/[，。；？！、：,.!?;]/)) {
      const clause = raw.trim();
      if (countCjk(clause) >= 2) return clause;
    }
    return '诗中景致';
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]!.text;
}

function genreOf(title: string): string {
  if (title.endsWith('赋') || title.endsWith('七发')) return '赋';
  if (title.endsWith('记')) return '记';
  if (title.endsWith('序')) return '序';
  if (title.endsWith('铭')) return '铭';
  if (title.endsWith('说')) return '说';
  if (title.endsWith('文')) return '文';
  if (title.endsWith('箴')) return '箴';
  if (title.endsWith('对')) return '对';
  return '骈文';
}

function formLabelOf(form: string | null): string {
  const value = String(form ?? '');
  if (value.includes('律')) return '律诗';
  if (value.includes('古风') || value.includes('古诗')) return '古风';
  return '诗';
}

function generateAppreciation(poem: Poem): string {
  const random = mulberry32(poem.id * 2654435761);
  const lines = Array.isArray(poem.content) ? poem.content : [];
  const content = lines.join(' ');
  const theme = detectTheme(content, String(poem.title ?? ''));
  const [primaryCraft, secondaryCraft] = detectCrafts(poem, content, random);
  const dynastyPool = OPENERS[poem.dynasty] ?? OPENERS.tang!;
  const genre = genreOf(String(poem.title ?? ''));
  const formLabel = formLabelOf(poem.form);
  const opener = pick(dynastyPool, random).replace('{form}', formLabel).replace('{genre}', genre);
  const clause = chooseClause(lines, theme, random);
  const themePhrase = pick(THEME_PHRASES[theme], random);
  const craftPhrase = pick(CRAFT_PHRASES[primaryCraft], random);
  const secondCraftPhrase = pick(CRAFT_PHRASES[secondaryCraft], random);
  const closingPool = CLOSINGS[poem.dynasty] ?? CLOSINGS.tang!;

  const head = `${opener}「${clause}」，${themePhrase}。`;
  const closing = pick(closingPool, random);
  const withOneCraft = `${head}${craftPhrase}。${closing}`;
  const withTwoCrafts = `${head}${craftPhrase}；${secondCraftPhrase}。${closing}`;
  let text = withTwoCrafts.length <= 118 ? withTwoCrafts : withOneCraft;

  while (countCjk(text) < 62 || text.length < 64) {
    const filler = pick(FILLERS, random);
    if (text.length + filler.length > 118) break;
    text += filler;
  }
  return text;
}

function readPoems(): Poem[] {
  const files = readdirSync(POEMS_DIR).filter((file) => /^\d+\.json$/.test(file));
  return files.map((file) => JSON.parse(readFileSync(join(POEMS_DIR, file), 'utf8')) as Poem);
}

function main(): void {
  const poems = readPoems();
  const byId = new Map<number, Poem>(poems.map((poem) => [poem.id, poem]));

  // 1. Authors for the anonymous pianwen pieces (only ids we are certain of).
  let authorsFilled = 0;
  for (const [id, author] of Object.entries(CIFU_AUTHORS)) {
    const poem = byId.get(Number(id));
    if (poem && !poem.author) {
      poem.author = author;
      authorsFilled++;
    }
  }

  // 2. Conservative category inference: only tang→诗, song→词.
  let categoriesFilled = 0;
  for (const poem of poems) {
    if (poem.category != null) continue;
    if (poem.dynasty === 'tang') {
      poem.category = '诗';
      categoriesFilled++;
    } else if (poem.dynasty === 'song') {
      poem.category = '词';
      categoriesFilled++;
    }
  }

  // 3. Exact-duplicate bodies: lowest id is canonical, others get variantOf.
  const groups = new Map<string, Poem[]>();
  for (const poem of poems) {
    const key = JSON.stringify(poem.content);
    const group = groups.get(key) ?? [];
    group.push(poem);
    groups.set(key, group);
  }
  let variantsMarked = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const canonical = Math.min(...group.map((poem) => poem.id));
    for (const poem of group) {
      if (poem.id !== canonical && poem.variantOf == null) {
        poem.variantOf = canonical;
        variantsMarked++;
      }
    }
  }

  // 4. Generate appreciations.
  let appreciationsGenerated = 0;
  for (const poem of poems) {
    if (typeof poem.appreciation === 'string' && poem.appreciation.length > 0) continue;
    poem.appreciation = generateAppreciation(poem);
    appreciationsGenerated++;
  }

  // 5. Write back only changed files, preserving key order.
  let filesWritten = 0;
  for (const poem of poems) {
    const filePath = join(POEMS_DIR, `${poem.id}.json`);
    const before = readFileSync(filePath, 'utf8');
    const after = `${JSON.stringify(poem, null, 2)}\n`;
    if (before !== after) {
      writeFileSync(filePath, after, 'utf8');
      filesWritten++;
    }
  }

  // 6. Move raw collections out of the loader directory.
  let rawFilesMoved = 0;
  if (RAW_FILES.some((file) => existsSync(join(POEMS_DIR, file)))) {
    mkdirSync(SOURCE_DIR, { recursive: true });
    for (const file of RAW_FILES) {
      const from = join(POEMS_DIR, file);
      const to = join(SOURCE_DIR, file);
      if (existsSync(from)) {
        if (existsSync(to)) throw new Error(`raw collection target already exists: ${to}`);
        renameSync(from, to);
        rawFilesMoved++;
      }
    }
  }

  // 7. Refresh manifest values from the enriched poems and add the count.
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    version: number;
    updatedAt: string;
    count: number;
    items: ManifestItem[];
    appreciationCount?: number;
  };
  for (const item of manifest.items) {
    const poem = byId.get(item.id);
    if (!poem) continue;
    item.author = poem.author;
    item.category = poem.category;
  }
  manifest.appreciationCount = poems.filter(
    (poem) => typeof poem.appreciation === 'string' && poem.appreciation.length > 0,
  ).length;
  manifest.updatedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const lengths = poems.map((poem) => (poem.appreciation ?? '').length);
  console.log(
    JSON.stringify(
      {
        poems: poems.length,
        appreciationsGenerated,
        authorsFilled,
        categoriesFilled,
        variantGroups: [...groups.values()].filter((group) => group.length > 1).length,
        variantsMarked,
        filesWritten,
        rawFilesMoved,
        appreciationCount: manifest.appreciationCount,
        appreciationLength: { min: Math.min(...lengths), max: Math.max(...lengths) },
      },
      null,
      2,
    ),
  );
}

main();
