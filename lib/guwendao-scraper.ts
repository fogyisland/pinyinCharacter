/**
 * Scraping primitives for guwendao.net (原古诗文网).
 *
 * Extracted from scripts/build-classics-guwendao.ts so the same fetch +
 * HTML-parsing primitives can be reused by T6 (poems: yuefu/shijiu/cifu)
 * and T7 (训蒙骈句) without copy-paste.
 *
 * Conventions:
 *  - guwendao book index lives at /guwen/book_<bookId>.aspx
 *  - guwendao chapter page lives at /guwen/bookv_<chapterId>.aspx
 *  - guwendao poem (single) lives at /shiwenv_<poemId>.aspx
 *  - guwendao category list lives at /gushi/<category>.aspx
 *  - Paragraph body sits inside <div class="contson"> ... </div>
 */
const BASE = 'https://www.guwendao.net';
const USER_AGENT = 'pinyin-character-build/1.0';

// Common HTML entity decoding for guwendao content. These appear in poems
// and book chapters; without decoding the strings surface as raw entity
// literals in the UI.
const ENTITY_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/g, ' '],
  [/&ldquo;/g, '"'],
  [/&rdquo;/g, '"'],
  [/&lsquo;/g, "'"],
  [/&rsquo;/g, "'"],
  [/&mdash;/g, '—'],
  [/&ndash;/g, '–'],
  [/&hellip;/g, '…'],
];

function decodeEntities(s: string): string {
  let out = s;
  for (const [re, replacement] of ENTITY_REPLACEMENTS) {
    out = out.replace(re, replacement);
  }
  return out;
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`fetch ${path} → ${res.status}`);
  return res.text();
}

export async function fetchChapterList(bookId: string): Promise<string[]> {
  const html = await fetchText(`/guwen/book_${bookId}.aspx`);
  const matches = [...html.matchAll(/bookv_([0-9a-f]+)\.aspx/g)];
  return [...new Set(matches.map(m => m[1]))];
}

export interface ChapterContent {
  title: string;
  paragraphs: string[];
}

function parseChapterHtml(html: string): { title: string; paragraphs: string[] } {
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/) || html.match(/class="book-title"[^>]*>([^<]+)</);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const contentMatch = html.match(/<div class="contson"[^>]*>([\s\S]*?)<\/div>/);
  if (!contentMatch) return { title, paragraphs: [] };
  const inner = contentMatch[1];
  const paragraphs = inner
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>/g, '\n')
    .split('\n')
    .map(s => decodeEntities(s.replace(/<[^>]+>/g, '')).trim())
    .filter(s => s.length > 0);
  return { title, paragraphs };
}

export async function scrapeChapterContent(bookId: string, chapterId: string): Promise<ChapterContent> {
  const html = await fetchText(`/guwen/bookv_${chapterId}.aspx`);
  return parseChapterHtml(html);
}

export type PoemCategory = 'yuefu' | 'shijiu' | 'cifu';

export async function scrapePoemList(category: PoemCategory): Promise<string[]> {
  const html = await fetchText(`/gushi/${category}.aspx`);
  const matches = [...html.matchAll(/shiwenv_([0-9a-f]+)\.aspx/g)];
  return [...new Set(matches.map(m => m[1]))];
}

export interface PoemPage {
  title: string;
  author: string;
  dynasty: string;
  paragraphs: string[];
}

function parsePoemHtml(html: string): PoemPage {
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = titleMatch ? titleMatch[1].trim() : '';
  // author + dynasty: pattern "作者：李白 · 唐" or class="sons"
  // Dynasty character class covers 单 (汉/魏/晋/唐/宋/元/明/清) +
  // modifiers (东/西/南北) + the 5-dynasties era (五代, 907-960).
  const authorMatch = html.match(/作者[：:]\s*<a[^>]*>([^<]+)<\/a>/) || html.match(/class="sons"[^>]*>[\s\S]*?>([^<]+)</);
  const author = authorMatch ? authorMatch[1].trim() : '';
  const dynastyMatch = html.match(/[·・]([东西南北朝汉魏晋隋唐宋元明清五代]+)(?=\s*<)/) || html.match(/朝代[：:]\s*([东西南北朝汉魏晋隋唐宋元明清五代]+)/);
  const dynasty = dynastyMatch ? dynastyMatch[1].trim() : '';
  // paragraph body sits in <div class="contson"> just like chapter pages
  const { paragraphs } = parseChapterHtml(html);
  return { title, author, dynasty, paragraphs };
}

export async function scrapePoemPage(poemId: string): Promise<PoemPage> {
  const html = await fetchText(`/shiwenv_${poemId}.aspx`);
  return parsePoemHtml(html);
}
