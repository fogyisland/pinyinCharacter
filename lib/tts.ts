'use client';

import type { SpeakOpts } from './tts-types';

export type Voice = 'male' | 'female';

/**
 * Max chars per /api/tts request from this client. Edge TTS times out past
 * ~25s on long batches, and `/api/tts` itself sits behind a 30s route budget,
 * so we cap each batch at 500 chars — about 2-3s of speech, well under both
 * ceilings. Larger inputs (sutra chunks, long paragraphs) get split on \n
 * into sentences and read sequentially.
 */
const BATCH_MAX_CHARS = 500;

interface ActivePlayback {
  audio: HTMLAudioElement;
  url: string;
  cancelled: boolean;
}

let active: ActivePlayback | null = null;

// Module-level pagehide/visibilitychange listeners stop speak() when the user
// navigates away. React doesn't own the Audio instance created in speak() (it
// lives outside the component tree), so component unmount cleanup alone won't
// fire — and a still-playing new Audio(src) keeps playing after the page
// detaches from the DOM. These listeners are the safety net for soft
// navigations, BFCache, tab switches, and component unmounts. Installed once
// on module load (browser only); no-op on the server.
if (typeof window !== 'undefined') {
  const stop = () => {
    if (active) clearActive();
  };
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop();
  });
}

function splitBatches(text: string): string[] {
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
  const batches: string[] = [];
  let buf = '';
  for (const p of paragraphs) {
    if (buf.length > 0 && buf.length + 1 + p.length > BATCH_MAX_CHARS) {
      batches.push(buf);
      buf = '';
    }
    buf = buf.length === 0 ? p : `${buf} ${p}`;
  }
  if (buf.length > 0) batches.push(buf);
  return batches;
}

function clearActive(): void {
  if (!active) return;
  active.cancelled = true;
  active.audio.pause();
  URL.revokeObjectURL(active.url);
  active = null;
}

export function stopSpeaking(): void {
  clearActive();
}

export async function speak(text: string, opts: SpeakOpts & { voice?: Voice } = {}): Promise<void> {
  if (!text) return;
  clearActive();
  const voice = opts.voice ?? 'female';
  const batches = splitBatches(text);
  if (batches.length === 0) return;

  for (let i = 0; i < batches.length; i++) {
    const isLast = i === batches.length - 1;
    const batch = batches[i]!;
    let res: Response;
    try {
      res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: batch, voice }),
      });
    } catch (e) {
      throw new Error(`TTS network error: ${(e as Error).message}`);
    }
    if (!res.ok) {
      throw new Error(`TTS failed: HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const playback: ActivePlayback = { audio, url, cancelled: false };
    active = playback;

    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        URL.revokeObjectURL(url);
        if (active === playback) active = null;
        resolve();
      };
      audio.onended = () => {
        finish();
        if (isLast && !playback.cancelled) opts.onEnd?.();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (active === playback) active = null;
        reject(new Error('audio playback error'));
      };
      audio.play().catch((e) => {
        URL.revokeObjectURL(url);
        if (active === playback) active = null;
        reject(e);
      });
    }).catch((e) => {
      // Bubble up so callers can surface the error instead of falling back to
      // a mechanical browser voice (which is what used to happen here).
      throw e;
    });

    if (playback.cancelled) {
      // stopSpeaking() / clearActive() ran mid-stream — bail without firing onEnd.
      // (Normal onended completion leaves `active = null` but cancelled stays false,
      // so the loop continues to the next batch.)
      return;
    }
  }
}