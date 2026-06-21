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

export async function scrapeChapterContent(bookId: string, chapterId: string): Promise<ChapterContent> {
  const html = await fetchText(`/guwen/bookv_${chapterId}.aspx`);
  // title: <h1>...</h1> or first .book-title
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/) || html.match(/class="book-title"[^>]*>([^<]+)</);
  const title = titleMatch ? titleMatch[1].trim() : '';
  // content: <div class="contson">...</div>
  const contentMatch = html.match(/<div class="contson"[^>]*>([\s\S]*?)<\/div>/);
  if (!contentMatch) return { title, paragraphs: [] };
  const inner = contentMatch[1];
  // split by <p> or <br/>
  const paragraphs = inner
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>/g, '\n')
    .split('\n')
    .map(s => s.replace(/<[^>]+>/g, '').trim())
    .filter(s => s.length > 0);
  return { title, paragraphs };
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

export async function scrapePoemPage(poemId: string): Promise<PoemPage> {
  const html = await fetchText(`/shiwenv_${poemId}.aspx`);
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = titleMatch ? titleMatch[1].trim() : '';
  // author + dynasty: pattern "作者：李白 · 唐" or class="sons"
  const authorMatch = html.match(/作者[：:]\s*<a[^>]*>([^<]+)<\/a>/) || html.match(/class="sons"[^>]*>[\s\S]*?>([^<]+)</);
  const author = authorMatch ? authorMatch[1].trim() : '';
  const dynastyMatch = html.match(/[·・]([南北朝汉魏晋隋唐宋元明清]+)(?=\s*<)/) || html.match(/朝代[：:]\s*([南北朝汉魏晋隋唐宋元明清]+)/);
  const dynasty = dynastyMatch ? dynastyMatch[1].trim() : '';
  // content: same pattern as chapters
  const { paragraphs } = await scrapeChapterContent('', poemId); // reuse parser
  return { title, author, dynasty, paragraphs };
}
