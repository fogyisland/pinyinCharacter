import { getConfig } from './config';

const DEFAULTS = {
  voice_male: 'zh-CN-YunjianNeural',
  voice_female: 'zh-CN-XiaoxiaoNeural',
  audio_format: 'audio-24khz-48kbitrate-mono-mp3',
} as const;

export type TtsVoiceKey = 'male' | 'female';

export interface TtsConfig {
  voiceMale: string;
  voiceFemale: string;
  audioFormat: string;
}

export async function getTtsConfig(): Promise<TtsConfig> {
  const [male, female, fmt] = await Promise.all([
    getConfig('tts.voice_male'),
    getConfig('tts.voice_female'),
    getConfig('tts.audio_format'),
  ]);
  return {
    voiceMale: male ?? DEFAULTS.voice_male,
    voiceFemale: female ?? DEFAULTS.voice_female,
    audioFormat: fmt ?? DEFAULTS.audio_format,
  };
}
