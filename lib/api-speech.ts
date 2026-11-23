/**
 * Client API for the Azure assessment route.
 *
 * Kept apart from `lib/api-classes` and `lib/api-auth` because it is a third
 * feature with its own failure shape: the route answers with a machine
 * readable `code` that says whether to retry (rate-limit, upstream) or to
 * send the operator to the admin panel (auth).
 */
import type { Assessment } from './speech-types';

/** The result of one assessment call. */
export type AssessApiResult =
  | { ok: true; assessment: Assessment }
  | { ok: false; code: string; message: string };

/**
 * Whether the paid path exists, and whether THIS caller may use it.
 *
 * Two separate answers, because they fail for different reasons: a missing
 * key is the operator's problem, a missing login is the visitor's. A single
 * boolean would make the panel either offer a button that always 401s or
 * hide a configured feature from everyone.
 */
export interface SpeechAvailability {
  /** The operator configured a key. */
  configured: boolean;
  /** The caller has a session — the POST needs one. */
  loggedIn: boolean;
}

/**
 * Ask whether the paid path is available.
 *
 * Never throws: a status probe that throws would break the panel's render.
 *
 * @returns both answers; `false/false` when the probe itself failed.
 */
export async function fetchAssessStatus(): Promise<SpeechAvailability> {
  try {
    const res = await fetch('/api/speech/assess');
    if (!res.ok) return { configured: false, loggedIn: false };
    const body = (await res.json()) as {
      ok: boolean;
      data?: { configured?: boolean; loggedIn?: boolean };
    };
    if (!body.ok || !body.data) return { configured: false, loggedIn: false };
    return {
      configured: Boolean(body.data.configured),
      loggedIn: Boolean(body.data.loggedIn),
    };
  } catch (error) {
    console.warn('[api-speech] the assessment status could not be read', error);
    return { configured: false, loggedIn: false };
  }
}

/**
 * Send one recording to the assessment route.
 *
 * @param wav the learner's recorded WAV.
 * @param reference the word they read.
 */
export async function assessWithAzure(
  wav: ArrayBuffer,
  reference: string,
): Promise<AssessApiResult> {
  try {
    const res = await fetch(`/api/speech/assess?reference=${encodeURIComponent(reference)}`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: wav,
      credentials: 'same-origin',
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; data?: { assessment?: Assessment }; error?: { code?: string; message?: string } }
      | null;
    if (!body) {
      return { ok: false, code: 'bad_response', message: `评估服务返回了无法解析的内容 (HTTP ${res.status})` };
    }
    if (!body.ok || !body.data?.assessment) {
      return {
        ok: false,
        code: body.error?.code ?? `http_${res.status}`,
        message: body.error?.message ?? '评估没有成功',
      };
    }
    return { ok: true, assessment: body.data.assessment };
  } catch (error) {
    return { ok: false, code: 'network', message: `网络异常：${(error as Error).message}` };
  }
}
