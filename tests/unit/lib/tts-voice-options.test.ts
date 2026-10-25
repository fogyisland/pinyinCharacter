import { describe, it, expect } from 'vitest';
import { TTS_FEMALE_VOICES, TTS_FORMATS, TTS_MALE_VOICES } from '@/lib/tts-voice-options';

/**
 * The DB defaults live in `lib/tts-config.ts` (`DEFAULTS`). That module imports
 * `lib/config.ts` → `lib/db.ts` (mysql2), so it cannot be imported here.
 * Instead the defaults are asserted as literals — the point of the test is to
 * pin the option lists to the same values so the two cannot drift apart.
 */
const DB_DEFAULT_MALE_VOICE = 'zh-CN-YunjianNeural';
const DB_DEFAULT_FEMALE_VOICE = 'zh-CN-XiaoxiaoNeural';
const DB_DEFAULT_AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

const LISTS: ReadonlyArray<{
  readonly name: string;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
}> = [
  { name: 'TTS_MALE_VOICES', options: TTS_MALE_VOICES },
  { name: 'TTS_FEMALE_VOICES', options: TTS_FEMALE_VOICES },
  { name: 'TTS_FORMATS', options: TTS_FORMATS },
];

describe('tts-voice-options', () => {
  it.each(LISTS)('$name is not empty', ({ options }) => {
    expect(options.length).toBeGreaterThan(0);
  });

  it.each(LISTS)('every entry of $name has a non-empty value and label', ({ options }) => {
    for (const option of options) {
      expect(typeof option.value).toBe('string');
      expect(option.value.trim().length).toBeGreaterThan(0);
      expect(typeof option.label).toBe('string');
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(LISTS)('the values of $name are unique within the list', ({ options }) => {
    const values = options.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('the first male voice is the DB default', () => {
    expect(TTS_MALE_VOICES[0].value).toBe(DB_DEFAULT_MALE_VOICE);
  });

  it('the first female voice is the DB default', () => {
    expect(TTS_FEMALE_VOICES[0].value).toBe(DB_DEFAULT_FEMALE_VOICE);
  });

  it('the first audio format is the DB default', () => {
    expect(TTS_FORMATS[0].value).toBe(DB_DEFAULT_AUDIO_FORMAT);
  });
});
