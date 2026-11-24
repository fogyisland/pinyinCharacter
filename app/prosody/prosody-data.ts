import { pinyin } from 'pinyin-pro';
import { toneFromPinyin, type Tone } from '@/lib/pinyin-tone';
import { finalOf, isPing, type DuiyunPair } from '@/lib/duiyun-rules';

export interface RhymeCategory {
  /** 韵部名称，如“一东” */
  name: string;
  /** 上平（1~15）或下平（16~30） */
  volume: '上平声十五韵' | '下平声十五韵';
  /** 该韵部在卷内的序号（0~14），对应《声律启蒙》《笠翁对韵》的 chunk 下标 */
  chunkIndex: number;
  /** 对应的古籍卷 slug */
  shenglvSlug: 'shenglv-qimeng-1' | 'shenglv-qimeng-2';
  liwengSlug: 'liweng-duiyun-1' | 'liweng-duiyun-2';
  /** 韵部音理与格律提示 */
  phoneticNote: string;
}

export const SHANG_PING_RHYMES = [
  ['一东', '收 ong / iong 鼻音，洪亮开阔，常作开篇大韵。'],
  ['二冬', '古音与东韵有别，今音多归 ong / iong，近体诗严韵须分押。'],
  ['三江', '古音近东冬，今音多转 iang / uang（如江、窗、双、邦）。'],
  ['四支', '收 i / ei / ui 等开口、齐齿、合口韵，字量极广。'],
  ['五微', '多收 ei / ui / i（如微、晖、飞、归、衣），清远婉转。'],
  ['六鱼', '收 ü / u（如鱼、书、居、余、初），撮口呼与合口呼并见。'],
  ['七虞', '收 u / ü（如虞、珠、途、夫、无），古音与六鱼邻近。'],
  ['八齐', '多收 i / ei / ai（如齐、溪、低、迷、西、啼）。'],
  ['九佳', '多收 ai / ia / ua（如佳、街、涯、怀、斋）。'],
  ['十灰', '多收 ui / ei / ai（如灰、回、梅、开、台、来）。'],
  ['十一真', '收 in / en / un / ün 前鼻音（如真、春、人、辰、尘）。'],
  ['十二文', '收 en / un / ün（如文、云、群、分、闻、熏）。'],
  ['十三元', '收 yuan / uan / an / en（如元、园、源、轩、言、门）。'],
  ['十四寒', '收 an / uan（如寒、山、兰、看、宽、欢）。'],
  ['十五删', '收 an / uan / yan（如删、关、湾、还、颜、山）。'],
] as const;

export const XIA_PING_RHYMES = [
  ['一先', '收 ian / üan（如先、天、年、烟、眠、弦），轻清流转。'],
  ['二萧', '收 iao（如萧、挑、貂、条、遥、桥），细长悠远。'],
  ['三肴', '收 ao / iao（如肴、巢、交、郊、梢、茅）。'],
  ['四豪', '收 ao（如豪、高、涛、袍、刀、劳），气势豪迈。'],
  ['五歌', '收 e / o / uo（如歌、多、罗、河、波、和）。'],
  ['六麻', '收 a / ia / ua（如麻、花、霞、家、茶、沙、斜）。'],
  ['七阳', '收 ang / iang / uang 后鼻音（如阳、光、香、长、章、堂）。'],
  ['八庚', '收 eng / ing / ong（如庚、更、生、明、声、城、情）。'],
  ['九青', '收 ing（如青、星、亭、庭、灵、听、屏）。'],
  ['十蒸', '收 eng / ing（如蒸、承、澄、陵、冰、升、凭）。'],
  ['十一尤', '收 ou / iu（如尤、流、楼、秋、舟、州、愁、游）。'],
  ['十二侵', '古收 -m 闭口音，今转 in / en（如侵、心、林、深、音、琴）。'],
  ['十三覃', '古收 -m 闭口音，今转 an（如覃、潭、南、参、骖、含）。'],
  ['十四盐', '古收 -m 闭口音，今转 ian / an（如盐、廉、帘、添、瞻）。'],
  ['十五咸', '古收 -m 闭口音，今转 an / ian（如咸、函、杉、帆、岩）。'],
] as const;

export const PINGSHUI_RHYMES: readonly RhymeCategory[] = [
  ...SHANG_PING_RHYMES.map(([name, phoneticNote], chunkIndex) => ({
    name,
    volume: '上平声十五韵' as const,
    chunkIndex,
    shenglvSlug: 'shenglv-qimeng-1' as const,
    liwengSlug: 'liweng-duiyun-1' as const,
    phoneticNote,
  })),
  ...XIA_PING_RHYMES.map(([name, phoneticNote], chunkIndex) => ({
    name,
    volume: '下平声十五韵' as const,
    chunkIndex,
    shenglvSlug: 'shenglv-qimeng-2' as const,
    liwengSlug: 'liweng-duiyun-2' as const,
    phoneticNote,
  })),
];

export interface MeterPreset {
  id: string;
  title: string;
  author: string;
  form: string;
  rhymeNote: string;
  /**
   * 格律谱：'平' 必平，'仄' 必仄，'中' 可平可仄。
   * 按四句或八句对应。
   */
  pattern: readonly string[];
  sample: string;
}

export const METER_PRESETS: readonly MeterPreset[] = [
  {
    id: 'wujue-zeqi',
    title: '五言绝句 · 仄起首句不入韵',
    author: '王之涣《登鹳雀楼》',
    form: '五绝（正格）',
    rhymeNote: '二、四句末字押下平十一尤（流、楼）。首句“白日依山尽”仄收不入韵。',
    pattern: ['中仄平平仄', '平平仄仄平', '中平平仄仄', '中仄仄平平'],
    sample: '白日依山尽\n黄河入海流\n欲穷千里目\n更上一层楼',
  },
  {
    id: 'wujue-pingqi',
    title: '五言绝句 · 平起首句不入韵',
    author: '王维《鹿柴》',
    form: '五绝（偏格）',
    rhymeNote:
      '此首为仄韵古绝：二、四句末字“响”“上”分属上声二十二养、去声二十三漾，皆仄声，故不入近体平韵正格；若按近体五绝平起格，二、四句当押平声韵。',
    pattern: ['中平平仄仄', '中仄仄平平', '中仄平平仄', '平平仄仄平'],
    sample: '空山不见人\n但闻人语响\n返景入深林\n复照青苔上',
  },
  {
    id: 'qijue-pingqi',
    title: '七言绝句 · 平起首句入韵',
    author: '李白《早发白帝城》',
    form: '七绝（正格）',
    rhymeNote: '一、二、四句末字“间、还、山”同押上平十五删。',
    pattern: ['中平中仄仄平平', '中仄平平仄仄平', '中仄中平平仄仄', '中平中仄仄平平'],
    sample: '朝辞白帝彩云间\n千里江陵一日还\n两岸猿声啼不住\n轻舟已过万重山',
  },
  {
    id: 'qijue-zeqi',
    title: '七言绝句 · 仄起首句不入韵',
    author: '杜甫《绝句》',
    form: '七绝（正格）',
    rhymeNote:
      '二、四句末字“天、船”同押下平一先；首句“柳”仄收不入韵。一、三字可平可仄，二、四、六字严守平仄交替。',
    pattern: ['中仄中平平仄仄', '中平中仄仄平平', '中平中仄平平仄', '中仄平平仄仄平'],
    sample: '两个黄鹂鸣翠柳\n一行白鹭上青天\n窗含西岭千秋雪\n门泊东吴万里船',
  },
  {
    id: 'wulv-zeqi',
    title: '五言律诗 · 仄起首句不入韵',
    author: '杜甫《春望》',
    form: '五律（八句四联）',
    rhymeNote: '偶句末字“深、心、金、簪”同押下平十二侵；颔联、颈联两两相对。',
    pattern: [
      '中仄平平仄',
      '平平仄仄平',
      '中平平仄仄',
      '中仄仄平平',
      '中仄平平仄',
      '平平仄仄平',
      '中平平仄仄',
      '中仄仄平平',
    ],
    sample:
      '国破山河在\n城春草木深\n感时花溅泪\n恨别鸟惊心\n烽火连三月\n家书抵万金\n白头搔更短\n浑欲不胜簪',
  },
];

export interface AnalyzedChar {
  char: string;
  syllable: string;
  tone: Tone | null;
  pingZe: '平' | '仄' | '轻';
  final: string;
  expected?: '平' | '仄' | '中';
  status: 'ok' | 'flexible' | 'mismatch';
  knownRhymes: string[];
}

export interface AnalyzedLine {
  raw: string;
  chars: AnalyzedChar[];
}

const PUNCT_RE = /[，。！？；：、,.!?;:\s“”‘’「」『』（）()《》〈〉—…]/g;

/**
 * 建立字 → 平水韵部映射（基于 761 副《笠翁对韵》《声律启蒙》对句词库）。
 */
export function buildCharRhymeIndex(pairs: readonly DuiyunPair[]): Map<string, string[]> {
  const index = new Map<string, Set<string>>();
  for (const pair of pairs) {
    for (const ch of [...pair.upper, ...pair.lower]) {
      let set = index.get(ch);
      if (!set) {
        set = new Set<string>();
        index.set(ch, set);
      }
      set.add(pair.rhyme);
    }
  }
  const out = new Map<string, string[]>();
  for (const [k, v] of index.entries()) {
    out.set(k, [...v]);
  }
  return out;
}

/**
 * 拆解用户输入的诗句，逐字标注拼音、平仄、韵母及与格律定式的合律情况。
 */
export function analyzePoemLines(
  input: string,
  pattern: readonly string[],
  rhymeIndex: ReadonlyMap<string, string[]>,
): AnalyzedLine[] {
  const rawLines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return rawLines.map((raw, lineIdx) => {
    const cleanChars = Array.from(raw.replace(PUNCT_RE, ''));
    const cleanText = cleanChars.join('');
    const syllables = cleanText ? pinyin(cleanText, { type: 'array' }) : [];
    const expectedLine = pattern[lineIdx] ?? '';

    const chars: AnalyzedChar[] = cleanChars.map((ch, idx) => {
      const syllable = syllables[idx] ?? '';
      const tone = toneFromPinyin(syllable);
      const pingZe: '平' | '仄' | '轻' = tone === null ? '轻' : isPing(tone) ? '平' : '仄';
      const expChar = expectedLine[idx] as '平' | '仄' | '中' | undefined;

      let status: 'ok' | 'flexible' | 'mismatch' = 'ok';
      if (expChar === '中') {
        status = 'flexible';
      } else if (expChar === '平' || expChar === '仄') {
        status = pingZe === expChar ? 'ok' : 'mismatch';
      }

      return {
        char: ch,
        syllable,
        tone,
        pingZe,
        final: finalOf(syllable),
        expected: expChar,
        status,
        knownRhymes: rhymeIndex.get(ch) ?? [],
      };
    });

    return { raw, chars };
  });
}

export interface ClassicCouplet {
  id: string;
  category: '蒙学成联' | '书斋励学' | '山水园林' | '岁时春联';
  horizontalBatch: string;
  upper: string;
  lower: string;
  source: string;
  structureNote: string;
  href?: string;
}

export const CLASSIC_COUPLETS: readonly ClassicCouplet[] = [
  {
    id: 'shenglv-1dong-7',
    category: '蒙学成联',
    horizontalBatch: '春光烂漫',
    upper: '两岸晓烟杨柳绿',
    lower: '一园春雨杏花红',
    source: '车万育《声律启蒙·卷上·一东》',
    structureNote:
      '二二三节奏：数目（两岸/一园）对时令天气（晓烟/春雨），花木（杨柳/杏花）对颜色（绿/红），上仄下平。',
    href: '/ancient/shenglv-qimeng-1?chunk=0',
  },
  {
    id: 'shenglv-1dong-11',
    category: '蒙学成联',
    horizontalBatch: '行止自适',
    upper: '两鬓风霜途次早行之客',
    lower: '一蓑烟雨溪边晚钓之翁',
    source: '车万育《声律启蒙·卷上·一东》',
    structureNote:
      '四六隔句长联：前四字写风貌（两鬓风霜/一蓑烟雨），后六字写处境与人物（早行之客/晚钓之翁）。',
    href: '/ancient/shenglv-qimeng-1?chunk=0',
  },
  {
    id: 'liweng-1dong-5',
    category: '蒙学成联',
    horizontalBatch: '秋霁澄明',
    upper: '风高秋月白',
    lower: '雨霁晚霞红',
    source: '李渔《笠翁对韵·卷上·一东》',
    structureNote:
      '二二一五言正格：风高对雨霁（主谓），秋月对晚霞（偏正），白（古入声仄）对红（东韵平）。',
    href: '/ancient/liweng-duiyun-1?chunk=0',
  },
  {
    id: 'liweng-1dong-7',
    category: '蒙学成联',
    horizontalBatch: '行吟山水',
    upper: '驿旅客逢梅子雨',
    lower: '池亭人挹藕花风',
    source: '李渔《笠翁对韵·卷上·一东》',
    structureNote: '二一四句法：驿旅对池亭，客逢对人挹，梅子雨对藕花风，时令与景致严丝合缝。',
    href: '/ancient/liweng-duiyun-1?chunk=0',
  },
  {
    id: 'shuzhai-shushan',
    category: '书斋励学',
    horizontalBatch: '学海无涯',
    upper: '书山有路勤为径',
    lower: '学海无涯苦作舟',
    source: '韩愈治学格言联',
    structureNote:
      '以山水舟径设喻：书山对学海，有路对无涯，勤为径对苦作舟，“径”去声仄收，“舟”尤韵平收。',
  },
  {
    id: 'shuzhai-fadong',
    category: '书斋励学',
    horizontalBatch: '知行合一',
    upper: '发愤识遍天下字',
    lower: '立志读尽人间书',
    source: '苏轼少年书斋联',
    structureNote: '动词领起：发愤对立志，识遍对读尽，天下字对人间书（“字”去声仄，“书”六鱼韵平）。',
  },
  {
    id: 'shuzhai-gusheng',
    category: '书斋励学',
    horizontalBatch: '天下为公',
    upper: '风声雨声读书声声声入耳',
    lower: '家事国事天下事事事关心',
    source: '顾宪成无锡东林书院联',
    structureNote: '叠字长联：三层并列名词渐次推扩，末以叠字“声声入耳”对“事事关心”，气脉宏阔。',
  },
  {
    id: 'shanshui-canglang',
    category: '山水园林',
    horizontalBatch: '沧浪清风',
    upper: '清风明月本无价',
    lower: '近水远山皆有情',
    source: '苏州沧浪亭联（集欧阳修、苏舜钦诗句）',
    structureNote: '集句联典范：上联出欧阳修《沧浪亭》，下联出苏舜钦《过苏州》，并列景物转哲思。',
  },
  {
    id: 'shanshui-yueyang',
    category: '山水园林',
    horizontalBatch: '洞庭天下',
    upper: '四面湖山归眼底',
    lower: '万家忧乐到心头',
    source: '湖南岳阳楼联',
    structureNote: '化用范仲淹《岳阳楼记》：四面湖山（实景）对万家忧乐（胸襟），归眼底对到心头。',
    href: '/poetry',
  },
  {
    id: 'chunlian-wanxiang',
    category: '岁时春联',
    horizontalBatch: '万象更新',
    upper: '天增岁月人增寿',
    lower: '春满乾坤福满门',
    source: '传统岁首春联',
    structureNote:
      '当句自对兼上下相对：天增对人增、春满对福满，“寿”去声仄收贴门右，“门”十三元平收贴门左。',
  },
  {
    id: 'chunlian-meihua',
    category: '岁时春联',
    horizontalBatch: '春回大地',
    upper: '梅传春信寒犹在',
    lower: '柳吐新芽暖已归',
    source: '传统立春时令联',
    structureNote: '物候相对：冬梅传信对春柳吐芽，寒犹在对暖已归，写出冬春交替之次第。',
  },
  {
    id: 'shenglv-2dong-7',
    category: '岁时春联',
    horizontalBatch: '四时佳兴',
    upper: '春日园中莺恰恰',
    lower: '秋天塞外雁雍雍',
    source: '车万育《声律启蒙·卷上·二冬》',
    structureNote: '时令与叠音拟声：春日对秋天，园中对塞外，莺恰恰对雁雍雍（二冬韵平声）。',
    href: '/ancient/shenglv-qimeng-1?chunk=1',
  },
];

export interface CoupletCheckResult {
  upper: AnalyzedChar[];
  lower: AnalyzedChar[];
  lengthEqual: boolean;
  tailRuleOk: boolean;
  opposedCount: number;
  summary: string;
}

/**
 * 校验上下联字数、逐位平仄相反度，以及“上联仄收、下联平收”定则。
 */
export function analyzeCouplet(
  upperText: string,
  lowerText: string,
  rhymeIndex: ReadonlyMap<string, string[]>,
): CoupletCheckResult {
  const [uLine] = analyzePoemLines(upperText || ' ', [], rhymeIndex);
  const [lLine] = analyzePoemLines(lowerText || ' ', [], rhymeIndex);
  const upper = uLine?.chars ?? [];
  const lower = lLine?.chars ?? [];
  const lengthEqual = upper.length > 0 && upper.length === lower.length;

  let opposedCount = 0;
  const minLen = Math.min(upper.length, lower.length);
  for (let i = 0; i < minLen; i++) {
    const u = upper[i]!.pingZe;
    const l = lower[i]!.pingZe;
    if ((u === '平' && l === '仄') || (u === '仄' && l === '平')) {
      opposedCount++;
    }
  }

  const uTail = upper[upper.length - 1]?.pingZe;
  const lTail = lower[lower.length - 1]?.pingZe;
  const tailRuleOk = uTail === '仄' && lTail === '平';

  let summary = '';
  if (upper.length === 0 || lower.length === 0) {
    summary = '请输入上下联以校验平仄相对。';
  } else if (!lengthEqual) {
    summary = `上下联字数不等（上联 ${upper.length} 字，下联 ${lower.length} 字）。`;
  } else if (!tailRuleOk) {
    summary = `尾字未合“上仄下平”（当前上联尾字为${uTail}，下联尾字为${lTail}）。共 ${opposedCount}/${minLen} 字平仄相对。`;
  } else {
    summary = `合乎“上联仄收、下联平收”定则，全联 ${opposedCount}/${minLen} 字平仄相对。`;
  }

  return {
    upper,
    lower,
    lengthEqual,
    tailRuleOk,
    opposedCount,
    summary,
  };
}
