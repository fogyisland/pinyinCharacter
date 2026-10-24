'use client';

import { useState } from 'react';
import { speak, stopSpeaking, type Voice } from '@/lib/tts';

type Size = 'sm' | 'md' | 'lg';

interface Props {
  text: string;
  label?: string;
  size?: Size;
  variant?: 'paper' | 'ink' | 'seal';
  className?: string;
  title?: string;
  voice?: Voice;
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'px-2 py-1 text-xs gap-1',
  md: 'px-3 py-1.5 text-sm gap-1.5',
  lg: 'px-4 py-2 text-base gap-2',
};

const VARIANT_CLASS = {
  paper:
    'border border-ink/30 text-ink-soft bg-paper-soft hover:bg-paper hover:border-ink/60 hover:text-ink',
  ink: 'border border-ink/60 text-ink bg-paper hover:bg-ink hover:text-paper-soft',
  seal: 'border border-seal/60 text-seal bg-paper-soft hover:bg-seal hover:text-paper-soft',
} as const;

export function ReadAloudButton({
  text,
  label,
  size = 'md',
  variant = 'paper',
  className = '',
  title = '单击朗读，双击停止',
  voice = 'female',
}: Props) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!text) return;
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
      return;
    }
    setError(null);
    setIsSpeaking(true);
    try {
      await speak(text, { voice, onEnd: () => setIsSpeaking(false) });
    } catch (e) {
      // 合成失败时必须把状态复位，否则按钮会一直停在「停止」，
      // 用户既看不到提示也点不动第二次。
      setIsSpeaking(false);
      const message = (e as Error).message;
      console.error('[朗读失败]', message);
      setError(message);
    }
  }

  function handleDouble() {
    stopSpeaking();
    setIsSpeaking(false);
  }

  return (
    <>
      <button
        type="button"
        disabled={!text}
        onClick={handleClick}
        onDoubleClick={handleDouble}
        aria-pressed={isSpeaking}
        title={title}
        className={`inline-flex items-center rounded-sm font-kai tracking-widest transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${className}`}
      >
        <SpeakerIcon active={isSpeaking} />
        <span>{isSpeaking ? '停止' : (label ?? '朗读')}</span>
      </button>
      {error ? (
        <span role="alert" title={error} className="ml-1 whitespace-nowrap text-xs text-seal/80">
          朗读失败
        </span>
      ) : null}
    </>
  );
}

function SpeakerIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {active ? (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      ) : (
        <path d="M22 9L16 15" />
      )}
    </svg>
  );
}
