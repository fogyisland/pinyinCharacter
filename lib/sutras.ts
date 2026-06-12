import type { SutraChunk } from './sutra-types';

const PIN_MARKER_RE = /第[一二三四五六七八九十百千零〇]+品|分第[一二三四五六七八九十百千零〇]+/;

/**
 * Split a sutra's paragraphs into chunks based on 品 markers.
 * - If a paragraph starts with "第X品..." (e.g. 法会因由分第一), a new chunk begins.
 * - Otherwise, all paragraphs fold into a single chunk labelled by the sutra title.
 */
export function splitIntoChunks(title: string, paragraphs: string[]): SutraChunk[] {
  if (paragraphs.length === 0) return [];

  const chunks: SutraChunk[] = [];
  let current: { label: string; content: string[] } | null = null;

  const hasMarker = paragraphs.some((p) => PIN_MARKER_RE.test(p));

  for (const para of paragraphs) {
    if (PIN_MARKER_RE.test(para)) {
      if (current) chunks.push({ id: chunks.length, ...current });
      current = { label: para.slice(0, 32), content: [para] };
    } else {
      if (!current) current = { label: hasMarker ? para.slice(0, 32) : title, content: [para] };
      else current.content.push(para);
    }
  }
  if (current) chunks.push({ id: chunks.length, ...current });

  return chunks;
}
