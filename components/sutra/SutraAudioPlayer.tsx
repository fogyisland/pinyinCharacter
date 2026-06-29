'use client';

import { useEffect, useRef, useState } from 'react';

export type SutraAudioLoopMode = 'single' | 'list' | 'none';

export interface SutraAudioPlayerProps {
  src: string;
  title?: string;
  className?: string;
}

export function SutraAudioPlayer({ src, title = '大悲咒', className }: SutraAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [loopMode, setLoopMode] = useState<SutraAudioLoopMode>('single');
  const [expanded, setExpanded] = useState(false);
  const [errored, setErrored] = useState(false);

  const loopModeRef = useRef<SutraAudioLoopMode>(loopMode);
  useEffect(() => {
    loopModeRef.current = loopMode;
  }, [loopMode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = loopMode === 'single';
  }, [loopMode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      if (loopModeRef.current === 'list') {
        audio.currentTime = 0;
        audio.play().catch(() => setErrored(true));
      }
    };
    const onError = () => setErrored(true);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
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

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const t = Number(e.target.value);
    audio.currentTime = t;
    setCurrentTime(t);
  }

  function handleVolume(e: React.ChangeEvent<HTMLInputElement>) {
    setVolume(Number(e.target.value));
  }

  function cycleLoopMode() {
    setLoopMode((m) => (m === 'single' ? 'list' : m === 'list' ? 'none' : 'single'));
  }

  return (
    <div
      className={`fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2 select-none ${className ?? ''}`}
    >
      <audio ref={audioRef} src={src} preload="metadata" />
      {expanded ? (
        <div className="bg-paper-warm/95 border border-ink/20 rounded-lg shadow-lg p-3 w-72 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-ink truncate pr-2">{title}</span>
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
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? '暂停' : '播放'}
              className="w-9 h-9 rounded-full bg-seal text-paper-warm flex items-center justify-center hover:bg-seal/90 transition-colors flex-shrink-0"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="flex-1 flex flex-col gap-1 min-w-0">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                onChange={handleSeek}
                aria-label="播放进度"
                className="w-full accent-seal"
                disabled={duration === 0}
              />
              <div className="flex justify-between text-[10px] text-ink-soft tabular-nums">
                <span>{fmtTime(currentTime)}</span>
                <span>{fmtTime(duration)}</span>
              </div>
            </div>
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
                onChange={handleVolume}
                aria-label="音量"
                className="flex-1 accent-seal"
              />
            </div>
          </div>
          {errored && (
            <div className="mt-2 text-[10px] text-ink-soft">音频文件未找到</div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={errored ? '展开播放器（音频文件未找到）' : '展开播放器'}
          title={errored ? '音频文件未找到' : title}
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

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
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