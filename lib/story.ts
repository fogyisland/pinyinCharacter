import 'server-only';
import { getContent } from './content';

export interface HanziStory {
  char: string;
  story: string;
  pinyin?: string;
}

/**
 * Read a char's 字源演变故事 (etymology_story).
 *
 * Reused by /stories/<char> as the universal story source — covers all
 * 7910 chars (L1/L2/L3), not just the L3 rare-char set. Renamed semantics:
 * the old "hanzi_story / rare.story" L3-only fields are no longer the
 * primary source; etymology_story is.
 *
 * Slim-DB order:
 *   1. data/content/<char>.json → content.etymology.story (preferred, 7910)
 *   2. data/content/<char>.json → content.hanzi_story (legacy top-level)
 *   3. data/content/<char>.json → content.rare.story (legacy L3 block)
 *
 * If none has a story, return null (page 404s).
 */
export async function getHanziStory(char: string): Promise<HanziStory | null> {
  const content = await getContent(char);
  if (content?.etymology?.story) {
    return { char: content.char, story: content.etymology.story, pinyin: content.pinyin };
  }
  if (content?.hanzi_story) {
    return { char: content.char, story: content.hanzi_story, pinyin: content.pinyin };
  }
  if (content?.rare?.story) {
    return { char: content.char, story: content.rare.story, pinyin: content.pinyin };
  }
  return null;
}