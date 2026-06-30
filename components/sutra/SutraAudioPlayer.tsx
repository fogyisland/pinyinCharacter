'use client';

import { useEffect, useRef, useState } from 'react';
import { getCachedTts, putCachedTts } from '@/lib/tts-cache';

export type SutraAudioLoopMode = 'single' | 'list' | 'none';

export type SutraAudioChunk = { id: number; title: string; text: string };

interface Props {
  /** Ordered list of chunks (1..N). At least one required. */
  chunks: SutraAudioChunk[];
  /** Display title for the playlist (shown above the current chunk). */
  playlistTitle?: string;
  className?: string;
}

/**
 * Max chars per /api/tts request. Server schema caps at 10000 but Edge TTS is
 * much slower + flaky past ~800, and SutraAudioPlayer wants each batch to
 * stream into the <audio> element quickly. 800 chars ≈ ~3s synthesis, which
 * keeps audio.play() almost instant and avoids the 30s route timeout.
 */
const BATCH_MAX_CHARS = 800;

function chunkToBatches(text: string): string[] {
  const paragraphs = text.split(/\n+/).filter((p) => p.trim().length > 0);
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

export function SutraAudioPlayer({ chunks, playlistTitle, className }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentBlobRef = useRef<string | null>(null);
  const fetchingRef = useRef(false);
  const [trackIndex, setTrackIndex] = useState(0);
  const [batchIndex, setBatchIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [loopMode, setLoopMode] = useState<SutraAudioLoopMode>('list');
  const [expanded, setExpanded] = useState(false);
  const [errored, setErrored] = useState(false);

  const currentChunk = chunks[trackIndex];

  // Loop mode ref for use in event handlers
  const loopModeRef = useRef<SutraAudioLoopMode>(loopMode);
  useEffect(() => {
    loopModeRef.current = loopMode;
  }, [loopMode]);

  // Volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Single-track loop is handled by browser (audio.loop = true) only in 'single' + 1 chunk
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.loop = loopMode === 'single' && chunks.length === 1;
    }
  }, [loopMode, chunks.length]);

  // Synthesize current chunk's current batch and set audio src
  async function loadAndPlay(chunkIdx: number, batchIdx: number) {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setErrored(false);
    try {
      const chunk = chunks[chunkIdx];
      if (!chunk) return;
      const batches = chunkToBatches(chunk.text);
      const batchText = batches[batchIdx];
      if (!batchText) return;

      let blob: Blob | null = await getCachedTts('female', batchText);
      if (!blob) {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: batchText, voice: 'female' }),
        });
        if (!res.ok) {
          setErrored(true);
          return;
        }
        blob = await res.blob();
        // Best-effort cache write; failure (quota / private mode) doesn't break playback.
        await putCachedTts('female', batchText, blob);
      }

      // Revoke previous blob to free memory
      if (currentBlobRef.current) URL.revokeObjectURL(currentBlobRef.current);
      const url = URL.createObjectURL(blob);
      currentBlobRef.current = url;
      const audio = audioRef.current;
      if (audio) {
        audio.src = url;
        if (playing) {
          await audio.play().catch(() => setErrored(true));
        }
      }
    } catch {
      setErrored(true);
    } finally {
      fetchingRef.current = false;
    }
  }

  // When trackIndex changes, reset batchIndex to 0 and load
  useEffect(() => {
    if (chunks.length === 0) return;
    setBatchIndex(0);
    loadAndPlay(trackIndex, 0);
    // eslint-disable-next-line react-hooks/disable-exhaustive-deps
  }, [trackIndex]);

  // When batchIndex changes, load next batch (only after trackIndex init)
  useEffect(() => {
    if (chunks.length === 0) return;
    if (batchIndex === 0) return; // handled by trackIndex effect
    loadAndPlay(trackIndex, batchIndex);
    // eslint-disable-next-line react-hooks/disable-dehaustive-deps
  }, [batchIndex]);

  // Audio event listeners — ended → next batch (or next chunk)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (loopModeRef.current === 'single' && chunks.length === 1) return; // browser loops
      const chunk = chunks[trackIndex];
      if (!chunk) {
        setPlaying(false);
        return;
      }
      const totalBatches = chunkToBatches(chunk.text).length;
      if (batchIndex < totalBatches - 1) {
        setBatchIndex((i) => i + 1);
      } else if (loopModeRef.current === 'list' || trackIndex < chunks.length - 1) {
        setTrackIndex((i) => (i + 1) % chunks.length);
      } else {
        setPlaying(false);
      }
    };
    const onError = () => setErrored(true);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [trackIndex, batchIndex, chunks]);

  // Cleanup on unmount: stop audio + release blob URL. React doesn't auto-pause
  // <audio> when the component unmounts, and a still-playing src keeps playing
  // after the element is detached from the DOM — so we have to pause, clear src,
  // and call load() to force the element back to its initial state.
  useEffect(() => {
    return () => {
      if (currentBlobRef.current) URL.revokeObjectURL(currentBlobRef.current);
      currentBlobRef.current = null;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, []);

  // Also stop on pagehide / visibilitychange — covers cases where React hasn't
  // unmounted yet (BFCache, soft navigations, browser tab switches on some
  // platforms). Best-effort; React unmount cleanup is the primary path.
  useEffect(() => {
    function stop() {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        audio.pause();
      }
    }
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stop();
    });
    return () => {
      window.removeEventListener('pagehide', stop);
      document.removeEventListener('visibilitychange', () => {});
    };
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => setErrored(true));
    } else {
      audio.pause();
    }
  }

  function cycleLoopMode() {
    setLoopMode((m) => (m === 'single' ? 'list' : m === 'list' ? 'none' : 'single'));
  }

  function next() {
    // The [trackIndex] effect re-runs loadAndPlay, which fetches /api/tts
    // and (if playing) kicks off playback. No manual call needed here.
    setTrackIndex((i) => (i + 1) % chunks.length);
  }

  function prev() {
    setTrackIndex((i) => (i - 1 + chunks.length) % chunks.length);
  }

  if (chunks.length === 0) return null;

  const singleChunk = chunks.length === 1;
  const headerTitle = singleChunk ? (currentChunk?.title ?? playlistTitle ?? '') : (playlistTitle ?? '');
  const showPlaylist = chunks.length > 1;

  // Compute current batch progress for the single-chunk UI
  const totalBatches = currentChunk ? chunkToBatches(currentChunk.text).length : 1;
  const batchLabel = totalBatches > 1 ? ` ${batchIndex + 1}/${totalBatches}` : '';

  return (
    <div
      className={`fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2 select-none ${className ?? ''}`}
    >
      <audio ref={audioRef} preload="none" />
      {expanded ? (
        <div className="bg-paper-warm/95 border border-ink/20 rounded-lg shadow-lg p-3 w-72 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="min-w-0 pr-2">
              {showPlaylist && (
                <div className="text-[10px] text-ink-faint truncate">{headerTitle}</div>
              )}
              <div className="text-sm font-medium text-ink truncate">
                {currentChunk?.title ?? '—'}
                {showPlaylist ? (
                  <span className="text-[10px] text-ink-soft ml-1.5 tabular-nums">
                    {trackIndex + 1}/{chunks.length}
                  </span>
                ) : (
                  <span className="text-[10px] text-ink-soft ml-1.5 tabular-nums">
                    {batchLabel.trim()}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="最小化播放器"
              className="text-ink-soft hover:text-ink p-1 flex-shrink-0"
            >
              <MinimizeIcon />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {showPlaylist && (
              <button
                type="button"
                onClick={prev}
                aria-label="上一曲"
                className="w-8 h-8 rounded-full text-ink-soft hover:text-ink flex items-center justify-center flex-shrink-0"
              >
                <PrevIcon />
              </button>
            )}
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? '暂停' : '播放'}
              className="w-9 h-9 rounded-full bg-seal text-paper-warm flex items-center justify-center hover:bg-seal/90 transition-colors flex-shrink-0"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            {showPlaylist && (
              <button
                type="button"
                onClick={next}
                aria-label="下一曲"
                className="w-8 h-8 rounded-full text-ink-soft hover:text-ink flex items-center justify-center flex-shrink-0"
              >
                <NextIcon />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={cycleLoopMode}
              aria-label={`循环模式: ${loopModeLabel(loopMode)}`}
              title={loopModeLabel(loopMode)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                loopMode === 'none'
                  ? 'text-ink-soft hover:text-ink'
                  : 'text-seal hover:text-seal/80'
              }`}
            >
              <LoopIcon mode={loopMode} />
              <span>{loopModeLabel(loopMode)}</span>
            </button>
            <div className="flex-1 flex items-center gap-1 min-w-0">
              <VolumeIcon muted={volume === 0} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="音量"
                className="flex-1 accent-seal"
              />
            </div>
          </div>
          {errored && (
            <div className="mt-2 text-[10px] text-ink-soft">合成失败</div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={errored ? '展开播放器（合成失败）' : '展开播放器'}
          title={errored ? '合成失败' : (currentChunk?.title ?? playlistTitle ?? '')}
          className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors ${
            errored
              ? 'bg-ink-soft/70 text-paper-warm hover:bg-ink-soft'
              : 'bg-seal text-paper-warm hover:bg-seal/90'
          }`}
        >
          {errored ? <AlertIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      )}
    </div>
  );
}

function loopModeLabel(m: SutraAudioLoopMode): string {
  return m === 'single' ? '单曲循环' : m === 'list' ? '列表循环' : '不循环';
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M4 2.5v9l8-4.5-8-4.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="3" y="2.5" width="3" height="9" rx="0.5" />
      <rect x="8" y="2.5" width="3" height="9" rx="0.5" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M11 2.5v9L4 7z" />
      <rect x="2" y="2.5" width="1.5" height="9" rx="0.5" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M3 2.5v9l7-4.5z" />
      <rect x="10.5" y="2.5" width="1.5" height="9" rx="0.5" />
    </svg>
  );
}

function LoopIcon({ mode }: { mode: SutraAudioLoopMode }) {
  const dim = mode === 'none';
  if (mode === 'single') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M2.5 6h7l-2-2M11.5 8h-7l2 2"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="7" y="11.5" fontSize="4.5" textAnchor="middle" fill="currentColor">1</text>
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" opacity={dim ? 0.45 : 1}>
      <path
        d="M2.5 6h7l-2-2M11.5 8h-7l2 2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="text-ink-soft flex-shrink-0">
      <path d="M3 5h2l3-2v8L5 9H3z" fill="currentColor" />
      {!muted && (
        <>
          <path d="M10 5.5c0.8 0.8 0.8 2.2 0 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" />
          <path d="M11.5 4c1.5 1.5 1.5 4.5 0 6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" />
        </>
      )}
    </svg>
  );
}