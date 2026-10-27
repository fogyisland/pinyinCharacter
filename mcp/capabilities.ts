/**
 * The catalogue of the MCP tools.
 *
 * The tools themselves live in `mcp/tools/`, one file per subject, and each
 * of them registers itself through `registerTool`. That is the source of
 * truth for *what* the server can do — but it is code, and code cannot be
 * shown on an admin page.
 *
 * This module is the human-readable twin of that registry: the same tool
 * names, the same display titles, and one Chinese line each explaining what
 * the tool answers. The admin page renders it, so an operator can see the
 * whole surface of the MCP service without reading the source.
 *
 * The two lists are pinned against each other by
 * `tests/unit/mcp/capabilities.test.ts`, which asks the running server for
 * its tool list and compares it with this catalogue. A tool added to
 * `mcp/tools/` without a catalogue entry (or the other way round) fails
 * that test — so the page can never quietly fall behind the server.
 *
 * This module is deliberately free of imports: it is data, it is safe on
 * the server and in the browser, and it never touches the database.
 */

/** The subject a tool belongs to. */
export type McpCapabilityCategory =
  | 'character'
  | 'pinyin'
  | 'quest'
  | 'worksheet'
  | 'poem'
  | 'sutra'
  | 'classic'
  | 'speech';

/** The Chinese label of each category, in the order the page shows them. */
export const MCP_CAPABILITY_CATEGORY_LABELS: { key: McpCapabilityCategory; label: string }[] = [
  { key: 'character', label: '汉字' },
  { key: 'pinyin', label: '拼音' },
  { key: 'quest', label: '闯关' },
  { key: 'worksheet', label: '字帖' },
  { key: 'poem', label: '古诗' },
  { key: 'sutra', label: '佛经' },
  { key: 'classic', label: '典籍' },
  { key: 'speech', label: '语音' },
];

/** One tool of the catalogue. */
export interface McpCapability {
  /** The tool's name, exactly as an MCP client sees it. */
  name: string;
  /** The tool's display title, exactly as the server registers it. */
  title: string;
  /** One Chinese line: what the tool answers. */
  summary: string;
  /** The subject the tool belongs to. */
  category: McpCapabilityCategory;
}

/**
 * Every tool the MCP endpoint serves.
 *
 * The order is the order the catalogue groups them in, and within a group
 * it follows the natural reading order of the subject (look up a character,
 * then its radical, then its strokes, then its tones).
 */
export const MCP_CAPABILITIES: readonly McpCapability[] = [
  {
    name: 'get_char',
    title: 'Look up a Han character',
    summary: '一个汉字的读音、释义、多音字、异体字与字的故事。',
    category: 'character',
  },
  {
    name: 'get_radical',
    title: "Get a character's radical",
    summary: '一个汉字的部首。',
    category: 'character',
  },
  {
    name: 'get_stroke_count',
    title: "Get a character's stroke count",
    summary: '一个汉字的笔画数。',
    category: 'character',
  },
  {
    name: 'get_tone_forms',
    title: 'Get the four tone forms of a character',
    summary: '一个音节带四种声调时的四种写法。',
    category: 'character',
  },
  {
    name: 'pinyin_to_hanzi',
    title: 'Find the characters of a pinyin syllable',
    summary: '一个拼音音节对应的汉字，按常用度排序。',
    category: 'pinyin',
  },
  {
    name: 'pinyin_to_sentence',
    title: 'Spell a sentence out of pinyin',
    summary: '把一串拼音还原成它拼出的句子。',
    category: 'pinyin',
  },
  {
    name: 'text_to_pinyin',
    title: 'Read a piece of text out in pinyin',
    summary: '一段文字的逐字拼音。',
    category: 'pinyin',
  },
  {
    name: 'build_quest_level',
    title: 'Build one level of the character quest',
    summary: '生成闯关的一关，含本关每个汉字的四道题。',
    category: 'quest',
  },
  {
    name: 'reveal_facets',
    title: 'Work out which hints may be shown',
    summary: '算出字卡在当前这一刻可以揭示哪一部分线索。',
    category: 'quest',
  },
  {
    name: 'generate_worksheet_layout',
    title: 'Lay out a practice worksheet',
    summary: '字帖的格子排布：要写的字、格子样式（米字格 / 田字格 / 四线格 / 横线 / 描红）与纸张大小。',
    category: 'worksheet',
  },
  {
    name: 'list_worksheet_schemes',
    title: 'List the worksheet schemes',
    summary: '现成字帖方案的目录：每个方案的格子样式、纸张大小与字体。',
    category: 'worksheet',
  },
  {
    name: 'render_worksheet_png',
    title: 'Render a practice worksheet as a PNG',
    summary: '把字帖渲染成 PNG 图片，作为图片内容块交给模型查看，并附上分页信息。',
    category: 'worksheet',
  },
  {
    name: 'list_poems',
    title: 'List the classical poems',
    summary: '古诗列表：标题、作者与朝代。',
    category: 'poem',
  },
  {
    name: 'get_poem',
    title: 'Read one classical poem',
    summary: '一首古诗：标题、作者、朝代、逐句正文与拼音、赏析与出处。',
    category: 'poem',
  },
  {
    name: 'list_sutras',
    title: 'List the Buddhist scriptures',
    summary: '佛经列表：标题、标识与它有多少章。',
    category: 'sutra',
  },
  {
    name: 'get_sutra_chunk',
    title: 'Read a chapter of a scripture',
    summary: '一章佛经：逐句正文与拼音；不给章号时返回章目。',
    category: 'sutra',
  },
  {
    name: 'list_classics',
    title: 'List the classical books',
    summary: '典籍列表：标题、作者、年代与分类。',
    category: 'classic',
  },
  {
    name: 'get_classic_outline',
    title: "Get a classical book's outline",
    summary: '一本典籍的目录：每一章的标题，不含正文。',
    category: 'classic',
  },
  {
    name: 'get_classic_chapter',
    title: 'Read one chapter of a classical book',
    summary: '典籍的一章：标题与逐句正文，附拼音。',
    category: 'classic',
  },
  {
    name: 'synthesize_speech',
    title: 'Read a piece of text out loud',
    summary: '一段文字的朗读：MP3 音频块，加上这次合成的元信息。',
    category: 'speech',
  },
];

/** The names of every tool in the catalogue, in catalogue order. */
export const MCP_CAPABILITY_NAMES: readonly string[] = MCP_CAPABILITIES.map((c) => c.name);

/**
 * The catalogue grouped by category, in the order the categories are
 * declared. A category with no tool in it does not appear.
 */
export function groupCapabilitiesByCategory(
  capabilities: readonly McpCapability[] = MCP_CAPABILITIES,
): { key: McpCapabilityCategory; label: string; items: McpCapability[] }[] {
  const groups: { key: McpCapabilityCategory; label: string; items: McpCapability[] }[] = [];
  for (const { key, label } of MCP_CAPABILITY_CATEGORY_LABELS) {
    const items = capabilities.filter((c) => c.category === key);
    if (items.length > 0) groups.push({ key, label, items });
  }
  return groups;
}
