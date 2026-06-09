'use client';

export interface SpeakOpts {
  rate?: number;            // 0.1 - 10
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
}

export function pickChineseVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find(v => v.lang === 'zh-CN') ??
    voices.find(v => v.lang.startsWith('zh')) ??
    null
  );
}

export function speak(text: string, opts: SpeakOpts = {}): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  stopSpeaking();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = opts.rate ?? 1;
  const voice = pickChineseVoice();
  if (voice) utter.voice = voice;
  if (opts.onBoundary) utter.onboundary = (e) => opts.onBoundary?.(e.charIndex);
  if (opts.onEnd) utter.onend = () => opts.onEnd?.();
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
}
