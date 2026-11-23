/**
 * Azure Speech —— server side of pronunciation assessment.
 *
 * Receives a short WAV from the learner and returns Azure's NBest assessment.
 * Nothing else: no storing, no logging of the audio, no caching. The
 * recording exists in memory for the duration of one request and is
 * discarded with it.
 *
 * Why a WAV and not WebM: Azure's short-audio endpoint takes WAV/PCM, and
 * MediaRecorder (the browser recorder) produces WebM/Opus in Chrome/Edge. The
 * client therefore records with the Web Audio API and encodes PCM itself — see
 * `lib/pronunciation-recorder.ts`.
 *
 * Why server-side at all: the subscription key must never reach the browser.
 * The route is the only place it exists.
 */
import {
  assessmentUrl,
  buildAssessmentHeader,
  classifySpeechFailure,
  resolveSpeechConfig,
  type SpeechFailure,
} from './azure-speech';
import type { Assessment, PhonemeScore, SyllableScore } from './speech-types';

export type { Assessment, PhonemeScore, SyllableScore } from './speech-types';

/** What the assessment call produced. */
export type AssessResult =
  | { ok: true; assessment: Assessment }
  | { ok: false; reason: SpeechFailure; message: string };

/** Azure's response shape, as far as this module reads it. */
interface AzureNBestWord {
  Word?: string;
  PronunciationAssessment?: {
    AccuracyScore?: number;
    FluencyScore?: number;
    CompletenessScore?: number;
    PronScore?: number;
    ProsodyScore?: number;
  };
  Syllables?: Array<{
    Syllable?: string;
    PronunciationAssessment?: {
      AccuracyScore?: number;
      FluencyScore?: number;
      CompletenessScore?: number;
      ProsodyScore?: number;
    };
  }>;
  Phonemes?: Array<{
    Phoneme?: string;
    PronunciationAssessment?: { AccuracyScore?: number };
  }>;
}

interface AzureResponse {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: Array<{
    Display?: string;
    AccuracyScore?: number;
    FluencyScore?: number;
    CompletenessScore?: number;
    PronScore?: number;
    ProsodyScore?: number;
    Words?: AzureNBestWord[];
  }>;
}

/** A failure like an outage or a bad key, turned into a learner-facing sentence. */
export function describeFailure(reason: SpeechFailure): string {
  switch (reason) {
    case 'unconfigured':
      return '站内还没有配置 Azure 语音服务，先用浏览器识别打分。';
    case 'auth':
      return 'Azure 语音密钥无效。请管理员到后台的「语音评测」页更新。';
    case 'rate-limit':
      return 'Azure 语音服务的配额用完了，请稍后再试。';
    case 'bad-request':
      return '这段录音 Azure 无法评估（通常是太短或格式不对），请再读一遍。';
    case 'upstream':
      return 'Azure 语音服务暂时不可用，请稍后再试。';
    case 'unknown':
      return '这次评估没有成功，请再读一遍。';
  }
}

/**
 * Score one recording.
 *
 * @param wav the learner's recording, 16 kHz mono PCM WAV.
 * @param reference the word they were asked to read.
 * @returns the assessment, or a classified failure.
 */
export async function assessPronunciation(
  wav: Uint8Array,
  reference: string,
): Promise<AssessResult> {
  const config = await resolveSpeechConfig();
  if (config === null) {
    return { ok: false, reason: 'unconfigured', message: describeFailure('unconfigured') };
  }

  const url = `${assessmentUrl(config.region)}?language=zh-CN`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.key,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Pronunciation-Assessment': buildAssessmentHeader(reference),
        Accept: 'application/json',
      },
      body: wav as unknown as BodyInit,
    });
  } catch (error) {
    // A network failure is the same class as a 5xx: retryable.
    console.error('[azure-speech] the assessment call could not be sent', error);
    return { ok: false, reason: 'upstream', message: describeFailure('upstream') };
  }

  if (!response.ok) {
    const reason = classifySpeechFailure(response.status);
    // The body explains WHICH key is wrong, or which format was refused;
    // without it an operator is stuck with a status number.
    const body = await response.text().catch(() => '');
    console.error(`[azure-speech] assessment failed with ${response.status}:`, body.slice(0, 400));
    return { ok: false, reason, message: describeFailure(reason) };
  }

  let payload: AzureResponse;
  try {
    payload = (await response.json()) as AzureResponse;
  } catch (error) {
    console.error('[azure-speech] the response was not JSON', error);
    return { ok: false, reason: 'unknown', message: describeFailure('unknown') };
  }

  return toAssessment(payload, reference);
}

/**
 * Turn Azure's verbose response into the numbers the panel shows.
 *
 * Azure puts the same numbers in two places (top-level and per word); the
 * panel wants the word-level ones, and the syllables for 「哪个字读得不好」.
 *
 * @param payload Azure's JSON.
 * @param reference the word the learner read.
 */
export function toAssessment(payload: AzureResponse, reference: string): AssessResult {
  const nbest = payload.NBest?.[0];
  if (!nbest) {
    // RecognitionStatus "NoMatch" lands here: nothing was recognised at all.
    return { ok: false, reason: 'bad-request', message: describeFailure('bad-request') };
  }

  const syllableScores: SyllableScore[] = [];
  const phonemeScores: PhonemeScore[] = [];
  for (const word of nbest.Words ?? []) {
    for (const syllable of word.Syllables ?? []) {
      const score = syllable.PronunciationAssessment;
      syllableScores.push({
        syllable: syllable.Syllable ?? '',
        accuracy: score?.AccuracyScore ?? 0,
        fluency: score?.FluencyScore ?? 0,
        completeness: score?.CompletenessScore ?? 0,
        prosody: score?.ProsodyScore ?? null,
      });
    }
    for (const phoneme of word.Phonemes ?? []) {
      phonemeScores.push({
        phoneme: phoneme.Phoneme ?? '',
        accuracy: phoneme.PronunciationAssessment?.AccuracyScore ?? 0,
      });
    }
  }

  return {
    ok: true,
    assessment: {
      reference,
      recognised: payload.DisplayText ?? nbest.Display ?? '',
      accuracy: nbest.AccuracyScore ?? 0,
      fluency: nbest.FluencyScore ?? 0,
      completeness: nbest.CompletenessScore ?? 0,
      prosody: nbest.ProsodyScore ?? null,
      pronunciation: nbest.PronScore ?? 0,
      syllables: syllableScores,
      phonemes: phonemeScores,
    },
  };
}

/**
 * The three scores Azure needs every request, and the two it cannot infer.
 *
 * Kept next to the assessment call so the route and the panel agree on what
 * was asked for.
 */
export const ASSESSMENT_SCORES = ['AccuracyScore', 'FluencyScore', 'CompletenessScore'] as const;
