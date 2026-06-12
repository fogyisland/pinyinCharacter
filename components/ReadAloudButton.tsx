'use client';

import { speak, stopSpeaking } from '@/lib/tts';

interface Props {
  text: string;
  label?: string;
}

export function ReadAloudButton({ text, label = '🔊 朗读' }: Props) {
  return (
    <button
      type="button"
      disabled={!text}
      onClick={() => {
        if (!text) return;
        speak(text);
      }}
      onDoubleClick={() => stopSpeaking()}
      className="px-3 py-1.5 text-sm border rounded hover:bg-paper-deep disabled:opacity-50 disabled:cursor-not-allowed"
      title="单击朗读，双击停止"
    >
      {label}
    </button>
  );
}
