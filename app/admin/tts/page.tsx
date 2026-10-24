import { getConfig } from '@/lib/config';
import {
  TtsConfigForm,
  TTS_FEMALE_VOICES,
  TTS_FORMATS,
  TTS_MALE_VOICES,
} from '@/components/admin/TtsConfigForm';
import { PageHeader } from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

/**
 * The voice settings page.
 *
 * The values are read here (on the server) and handed to the form island, so
 * opening the page needs no extra request. An unset key falls back to the
 * first option of its list — the API rejects an empty value, so the form
 * must never start empty.
 */
export default async function AdminTtsPage() {
  let voiceMale: string = TTS_MALE_VOICES[0].value;
  let voiceFemale: string = TTS_FEMALE_VOICES[0].value;
  let format: string = TTS_FORMATS[0].value;
  let error: string | null = null;

  try {
    const [male, female, audioFormat] = await Promise.all([
      getConfig('tts.voice_male'),
      getConfig('tts.voice_female'),
      getConfig('tts.audio_format'),
    ]);
    if (male) voiceMale = male;
    if (female) voiceFemale = female;
    if (audioFormat) format = audioFormat;
  } catch (err) {
    console.error('[admin/tts] failed to read the TTS config:', err);
    error = (err as Error).message || '配置读取失败';
  }

  return (
    <div>
      <PageHeader
        title="语音设置"
        description="站点全局默认音色,字典页「读字」用男声、「读音」用女声。"
      />

      {error && <p className="text-sm text-danger mb-4">配置读取失败：{error}</p>}

      {/* TtsConfigForm brings its own panel — wrapping it again would stack
          a card inside a card. */}
      <TtsConfigForm
        initialVoiceMale={voiceMale}
        initialVoiceFemale={voiceFemale}
        initialFormat={format}
      />
    </div>
  );
}
