/**
 * Regression tests for the classics API payloads.
 *
 * A classic book is up to 8 MB of JSON. The browser must never receive one:
 * the outline carries the chapter list, and a chapter request carries that
 * chapter's text without the per-character pinyin (which is the larger half
 * of a chapter and is only used by the server-rendered reading view).
 */
import { describe, it, expect } from 'vitest';
import {
  getClassicChunkBySlug,
  getClassicChapterPayload,
  getClassicOutlineBySlug,
} from '@/lib/classics';

const SLUG = 'lunyu';

describe('getClassicOutlineBySlug', () => {
  it('returns the chapter list without any chapter text', async () => {
    const outline = await getClassicOutlineBySlug(SLUG);
    if (!outline) return; // corpus not present on this host
    expect(outline.slug).toBe(SLUG);
    expect(outline.chunks.length).toBeGreaterThan(0);
    expect(outline.chunkCount).toBe(outline.chunks.length);
    for (const chunk of outline.chunks) {
      expect(Object.keys(chunk).sort()).toEqual(['id', 'label']);
    }
    expect(JSON.stringify(outline)).not.toContain('"content"');
  });
});

describe('getClassicChapterPayload', () => {
  it('returns the chapter text without the per-character pinyin', async () => {
    const chapter = await getClassicChapterPayload(SLUG, 0);
    if (!chapter) return;
    expect(chapter.content.length).toBeGreaterThan(0);
    expect(chapter.label.length).toBeGreaterThan(0);
    expect(chapter.chunkCount).toBeGreaterThan(0);
    expect('pinyin' in chapter).toBe(false);
  });

  it('is much smaller than the full chapter it replaces', async () => {
    const full = await getClassicChunkBySlug(SLUG, 0);
    const payload = await getClassicChapterPayload(SLUG, 0);
    if (!full || !payload) return;
    const fullBytes = JSON.stringify(full).length;
    const payloadBytes = JSON.stringify(payload).length;
    expect(payloadBytes).toBeLessThan(fullBytes / 2);
  });

  it('returns null for a chapter index outside the book', async () => {
    const chapter = await getClassicChapterPayload(SLUG, 99_999);
    expect(chapter).toBeNull();
  });
});
