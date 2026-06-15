'use client';

import type { SpeakOpts } from './tts-types';

export type Voice = 'male' | 'female';

// 模块级 active audio ref,允许 stopSpeaking() 中断正在播放
const activeAudio: { current: HTMLAudioElement | null } = { current: null };

export function pickChineseVoice(): SpeechSynthesisVoice | null {
  // 保留旧 export 用于可能回退,实际不再用
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find(v => v.lang === 'zh-CN') ?? voices.find(v => v.lang.startsWith('zh')) ?? null;
}

export async function speak(text: string, opts: SpeakOpts & { voice?: Voice } = {}): Promise<void> {
  if (!text) return;
  stopSpeaking();
  const voice = opts.voice ?? 'female';
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) {
      // 失败时降级到浏览器 speech
      console.warn('Edge TTS failed, fallback to browser speech', res.status);
      fallbackSpeak(text, opts);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio.current = audio;
    audio.onended = () => {
      if (activeAudio.current === audio) {
        activeAudio.current = null;
        URL.revokeObjectURL(url);
        opts.onEnd?.();
      }
    };
    audio.onerror = () => {
      if (activeAudio.current === audio) activeAudio.current = null;
      URL.revokeObjectURL(url);
    };
    await audio.play();
  } catch (e) {
    console.warn('Edge TTS error, fallback', e);
    fallbackSpeak(text, opts);
  }
}

function fallbackSpeak(text: string, opts: SpeakOpts): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = opts.rate ?? 1;
  const voice = pickChineseVoice();
  if (voice) utter.voice = voice;
  if (opts.onEnd) utter.onend = () => opts.onEnd?.();
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking(): void {
  if (activeAudio.current) {
    activeAudio.current.pause();
    activeAudio.current = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
