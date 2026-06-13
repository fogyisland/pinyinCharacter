import type { RareCharClient } from './api-rare-chars';

export async function fetchRandomStory(): Promise<RareCharClient> {
  const res = await fetch('/api/stories/random');
  const data = (await res.json()) as
    | { ok: true; data: RareCharClient }
    | { ok: false; error: { code: string; message?: string } };
  if (!data.ok) {
    throw new Error(`fetchRandomStory failed: ${data.error.code}`);
  }
  return data.data;
}