/**
 * 班级与作业 — 领域层（纯函数）。
 *
 * ## 为什么有这个文件
 *
 * 孔子学院开的是十到二十人的小班，老师每周要发一次「本周练这几个
 * 字」的班级作业。站内已有的字帖、听写、复习都在单人世界里：字帖存在
 * 自己的账号下，听写卷在浏览器里，老师没有任何办法把一批字派给一个
 * 班，也没有办法看到谁做完了。
 *
 * 这个模块只管规则：班级命名、邀请码、作业载荷的编解码、排序。它不碰
 * 数据库、不读文件，所以规则可以在没有 MySQL 的情况下被钉住。
 *
 * ## 为什么作业载荷是一个 JSON 列
 *
 * 作业的「内容」有两种完全不同的形状：字帖（一串字 + 一个已存的
 * worksheet id）和听写（一串「词 + 拼音」）。用一个 JSON 列承载，
 * 新类型不需要加列、不需要迁移。代价是数据库不校验内容，所以
 * `parseAssignmentPayload` 必须把每一种形状都验到底 —— 手改过的行、
 * 旧版本写下的行都要被当成「没有」而不是被猜成某一种。
 */

/** 班级名允许的最大长度（与 classes.name 列宽一致）。 */
export const MAX_CLASS_NAME = 64;

/** 创建班级时最多为邀请码重试几次。 */
export const MAX_JOIN_CODE_TRIES = 6;

/** 一节课/一份作业最多能带多少个字（与保存字帖的 500 上限一致）。 */
export const MAX_ASSIGNMENT_CHARS = 500;

/** 一份听写作业最多多少条。 */
export const MAX_DICTATION_ITEMS = 200;

/** 邀请码长度。 */
const JOIN_CODE_LENGTH = 6;

/**
 * 邀请码的字符集：去掉 0/O、1/I/l 这些手抄时会混的字符。
 *
 * 老师会把邀请码写在黑板上、发到群里，学生照着敲。少一个字符集，就少
 * 一类「我明明照着输的还是说班里没这个码」的求助。
 */
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * 班级名归一化：去首尾空白、把内部连续空白压成一个空格、按字符数截断。
 *
 * 按 `Array.from` 而不是 `.slice` 截断：`.slice` 会从一个代理对中间切
 * 下去，留下一个孤立的半个字符。
 *
 * @param name 老师输入的班级名。
 * @returns 归一化后的名字；全是空白时返回空串（调用方据此拒绝）。
 */
export function normalizeClassName(name: string): string {
  const collapsed = name.trim().replace(/\s+/g, ' ');
  return Array.from(collapsed).slice(0, MAX_CLASS_NAME).join('');
}

/**
 * 生成一个邀请码。
 *
 * 用 `crypto.getRandomValues` 而不是 `Math.random`：邀请码是班级的准入
 * 凭证，可预测的随机数意味着可枚举的班级。Node 和浏览器都提供
 * `crypto.getRandomValues`，这个模块因此不需要区分环境。
 *
 * @returns 6 位大写邀请码。
 */
export function generateJoinCode(): string {
  const bytes = new Uint8Array(JOIN_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
  }
  // 同一字符重复的码（AAAAAA）虽然合法，但学生抄错时无从发现。
  if (new Set(code).size === 1) {
    // 重掷一次；连续两次全同的概率是 (1/31)^11，可以忽略不计。
    return generateJoinCode();
  }
  return code;
}

/**
 * 邀请码是否合法。
 *
 * 只校验形状（长度 + 字符集 + 大小写），不校验是否存在 —— 存在与否要
 * 查库，那是 store 层的事。
 *
 * @param code 学生输入或老师指定的码。
 */
export function isJoinCode(code: string): boolean {
  if (code.length !== JOIN_CODE_LENGTH) return false;
  for (const char of code) {
    if (!JOIN_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

/** 一份作业的内容形状。 */
export type AssignmentPayload =
  | {
      kind: 'worksheet';
      title: string;
      /** 已保存的字帖 id；0 表示「用 chars 现场生成」。 */
      worksheetId: number;
      chars: string[];
    }
  | {
      kind: 'dictation';
      title: string;
      items: Array<{ word: string; pinyin: string }>;
    };

/** 构造作业载荷的入参。 */
export type AssignmentInput =
  | {
      kind: 'worksheet';
      title: string;
      worksheetId: number;
      chars: string[];
    }
  | {
      kind: 'dictation';
      title: string;
      items: Array<{ word: string; pinyin: string }>;
    };

/**
 * 把入参整理成要写进 JSON 列的载荷。
 *
 * 整理而不是校验：调用方（老师）已经通过了表单校验，这里的职责是把
 * 数组截到上限、去掉空条目，保证写下去的东西在读取时一定合法。
 *
 * 截止时间不在这里：它是「这一批作业」的属性，放进载荷会让同一份作业
 * 派给两个班时要写两份载荷。
 *
 * @param input 老师提交的内容。
 * @returns 要写入 JSON 列的对象。
 */
export function buildAssignmentPayload(input: AssignmentInput): AssignmentPayload {
  if (input.kind === 'worksheet') {
    return {
      kind: 'worksheet',
      title: input.title.trim().slice(0, MAX_CLASS_NAME),
      worksheetId: Math.max(0, Math.floor(input.worksheetId)),
      chars: input.chars.slice(0, MAX_ASSIGNMENT_CHARS),
    };
  }
  return {
    kind: 'dictation',
    title: input.title.trim().slice(0, MAX_CLASS_NAME),
    items: input.items
      .filter((item) => item.word.trim() !== '')
      .slice(0, MAX_DICTATION_ITEMS)
      .map((item) => ({ word: item.word.trim(), pinyin: item.pinyin.trim() })),
  };
}

/**
 * 把 JSON 列里读到的东西还原成载荷，无法还原时返回 null。
 *
 * 这里是**不信任任何一行**的地方：数据库里的 JSON 可能被旧版本写过、
 * 被手改过、被半截写入过。未知的 kind、空的字表、形状不对的听写条目，
 * 都当成「这份作业没有内容」，而不是猜成某一种形状 —— 页面把一份未知
 * 载荷渲染成字帖，老师会以为学生看到的是自己派的东西。
 *
 * @param raw `JSON.parse` 之后的值。
 * @returns 合法的载荷，或 null。
 */
export function parseAssignmentPayload(raw: unknown): AssignmentPayload | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title : '';
  if (record.kind === 'worksheet') {
    const chars = record.chars;
    if (!Array.isArray(chars) || chars.length === 0) return null;
    if (!chars.every((char) => typeof char === 'string' && char !== '')) return null;
    const worksheetId = record.worksheetId;
    if (typeof worksheetId !== 'number' || !Number.isFinite(worksheetId)) return null;
    return {
      kind: 'worksheet',
      title,
      worksheetId,
      chars: chars.slice(0, MAX_ASSIGNMENT_CHARS) as string[],
    };
  }
  if (record.kind === 'dictation') {
    const items = record.items;
    if (!Array.isArray(items) || items.length === 0) return null;
    const parsed: Array<{ word: string; pinyin: string }> = [];
    for (const item of items.slice(0, MAX_DICTATION_ITEMS)) {
      if (typeof item !== 'object' || item === null) return null;
      const entry = item as Record<string, unknown>;
      if (typeof entry.word !== 'string' || entry.word.trim() === '') return null;
      parsed.push({
        word: entry.word,
        pinyin: typeof entry.pinyin === 'string' ? entry.pinyin : '',
      });
    }
    return { kind: 'dictation', title, items: parsed };
  }
  return null;
}

/** 排序只看这三个字段。 */
export interface SortableAssignment {
  id: number;
  /** YYYY-MM-DD，或 null（没有截止日期）。 */
  dueAt: string | null;
  createdAt: string;
}

/**
 * 作业列表的排序：有截止日期的在前（按日期升序），没有截止的在后，
 * 同一日期按创建时间升序。
 *
 * 老师打开班级页时最想看到的是「这周要交的」，其次是「还没设截止的」。
 * 日期是 `YYYY-MM-DD`，可以直接按字符串比较 —— 不需要 `Date`，
 * 也就不受时区影响。
 *
 * @param assignments 待排序的作业。
 * @returns 新的数组；入参不被修改。
 */
export function sortAssignments<T extends SortableAssignment>(assignments: readonly T[]): T[] {
  return [...assignments].sort((a, b) => {
    if (a.dueAt !== null && b.dueAt === null) return -1;
    if (a.dueAt === null && b.dueAt !== null) return 1;
    if (a.dueAt !== null && b.dueAt !== null && a.dueAt !== b.dueAt) {
      return a.dueAt < b.dueAt ? -1 : 1;
    }
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id - b.id;
  });
}
