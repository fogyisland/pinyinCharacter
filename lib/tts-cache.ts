/**
 * Client-side cache for /api/tts MP3 responses.
 *
 * Why: Edge TTS takes 3-6s per batch (and 30+ batches for liuzu). If the user
 * re-reads the same sutra or re-listens to a chunk, re-synthesizing wastes time
 * + Edge TTS quota. The browser's Cache API persists across page reloads +
 * session restarts, holds hundreds of MB, and is async-friendly.
 *
 * Key derivation: SHA-256(`${voice}|${text}`). `format` is intentionally NOT
 * included because the audio_format in /admin/tts is a site-wide knob that
 * affects every cached entry uniformly; if an admin changes it, the new
 * synthesized MP3 will simply overwrite the old cache entry on the next
 * fetch — no invalidation needed.
 *
 * The cache key is used as a synthetic URL (`/tts-cache/<hash>`) so we can
 * reuse the standard Cache API match() flow without rolling a parallel storage
 * layer. The URL is never fetched — it only identifies the cache entry.
 *
 * No-ops gracefully if `caches` is unavailable (SSR, jsdom, old browsers).
 */

const CACHE_NAME = 'tts-v1';

async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isAvailable(): boolean {
  return typeof caches !== 'undefined' && typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

export async function getCachedTts(voice: string, text: string): Promise<Blob | null> {
  if (!isAvailable()) return null;
  try {
    const key = await digest(`${voice}|${text}`);
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(`/tts-cache/${key}`);
    if (!res) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

export async function putCachedTts(voice: string, text: string, blob: Blob): Promise<void> {
  if (!isAvailable()) return;
  try {
    const key = await digest(`${voice}|${text}`);
    const cache = await caches.open(CACHE_NAME);
    await cache.put(`/tts-cache/${key}`, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }));
  } catch {
    // best-effort: quota errors or private-mode caches are non-fatal
  }
}