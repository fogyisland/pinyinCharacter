/**
 * Azure Speech —— 配置与失败分类。
 *
 * ## 为什么需要这一层
 *
 * 浏览器自带的 `SpeechRecognition` 只能把「听到的文字」交回来；它不给
 * 音素级的发音评分。Azure 的 Pronunciation Assessment 能给出每个音节的
 * 声调、声母、韵母得分 —— 这是「学生读得准不准」真正需要的。
 *
 * ## 但它是付费服务，而且要把录音发出去
 *
 * 所以它必须是**可选**的：后台没配 key 时，功能回退到浏览器识别 + 本站
 * 自己的比对（`lib/pronunciation.ts`），一切照常。配了 key 才升级到
 * Azure 打分。这不是"优雅降级"，而是默认状态。
 *
 * ## 配置从哪来
 *
 * 和站内其他密钥一样走 `app_config`（后台 `/admin/speech` 写入）：
 *
 *     speech.region   eastasia / westus / ...
 *     speech.key      Azure 语音资源的密钥
 *
 * 环境变量 `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` 作为后备，方便
 * 不走后台的部署；数据库优先，因为它可以在线改。
 *
 * ## 失败分类决定行为
 *
 *   auth        401/403 —— 密钥错了。停手，告诉管理员去后台改，不重试。
 *   rate-limit  429     —— 超配额。可以稍后重试，不能当成密钥错误。
 *   bad-request 400     —— 请求本身有问题（音频格式/评估头）。重试无用。
 *   upstream    5xx     —— Azure 自己出问题。可以重试。
 *   unconfigured null   —— 没配。回退到浏览器识别。
 *
 * 把它们混成一个「失败」会掩盖真实原因：一个 429 报成「密钥错误」会让
 * 管理员去改一个没问题的密钥。
 */
import { getConfig } from './config';

/** The keys the admin panel writes. */
export const ASSESSMENT_KEYS = ['speech.key', 'speech.region'] as const;

/**
 * The per-user daily cap on paid assessments.
 *
 * Azure bills per audio second, so an unbounded retry loop is an unbounded
 * bill. The cap is a config key rather than a constant for the same reason
 * the region is: the operator changes it from the admin page, without a
 * deployment. `0` means unlimited, matching the other limits on the site.
 */
export const SPEECH_DAILY_LIMIT_KEY = 'speech.daily_limit';

/** What the cap is when the operator never set it. */
export const DEFAULT_DAILY_LIMIT = 20;

/**
 * Read the per-user daily cap.
 *
 * Falls back to {@link DEFAULT_DAILY_LIMIT} when the value is missing or
 * unusable: a broken setting must not silently become "unlimited", because
 * that is the direction that costs money.
 */
export async function resolveDailyLimit(): Promise<number> {
  const raw =
    (await getConfig(SPEECH_DAILY_LIMIT_KEY)) ??
    process.env.AZURE_SPEECH_DAILY_LIMIT ??
    '';
  const value = parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(value) || value < 0) return DEFAULT_DAILY_LIMIT;
  return value;
}

/** A usable Azure Speech configuration. */
export interface SpeechConfig {
  region: string;
  key: string;
}

/** Why a call to Azure failed. */
export type SpeechFailure =
  | 'unconfigured'
  | 'auth'
  | 'rate-limit'
  | 'bad-request'
  | 'upstream'
  | 'unknown';

/**
 * Read the configuration, or null when it is incomplete.
 *
 * Trims both values: a pasted key usually carries a trailing newline, and a
 * key with whitespace is a 401 nobody can explain.
 *
 * @returns the config, or null when either field is missing.
 */
export async function resolveSpeechConfig(): Promise<SpeechConfig | null> {
  const [region, key] = await Promise.all([
    getConfig('speech.region'),
    getConfig('speech.key'),
  ]);
  const resolvedRegion = (region ?? process.env.AZURE_SPEECH_REGION ?? '').trim();
  const resolvedKey = (key ?? process.env.AZURE_SPEECH_KEY ?? '').trim();
  if (resolvedRegion === '' || resolvedKey === '') return null;
  return { region: resolvedRegion, key: resolvedKey };
}

/**
 * Whether pronunciation assessment is available at all.
 *
 * The panel asks this before offering a paid path, so a site with no key
 * never sends a learner's recording anywhere.
 */
export async function isSpeechConfigured(): Promise<boolean> {
  return (await resolveSpeechConfig()) !== null;
}

/**
 * One sentence saying what an operator must fix.
 *
 * 「没配置」 makes them hunt for which of the two fields is empty;
 * 「缺少 region」 fixes it in one step. An empty string means nothing to fix.
 *
 * @param config the resolved config, or null.
 */
export function describeConfigState(config: SpeechConfig | null): string {
  if (config === null) return '未配置 Azure 语音服务（缺少 region 或 key）';
  const missing: string[] = [];
  if (config.region === '') missing.push('region');
  if (config.key === '') missing.push('key');
  if (missing.length === 0) return '';
  return `缺少 ${missing.join('、')}`;
}

/**
 * Classify a response status (or the absence of a config) into an action.
 *
 * @param status the HTTP status from Azure, or null when nothing was sent.
 */
export function classifySpeechFailure(status: number | null): SpeechFailure {
  if (status === null) return 'unconfigured';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 400 || status === 422) return 'bad-request';
  if (status >= 500 && status <= 599) return 'upstream';
  return 'unknown';
}

/**
 * The `Pronunciation-Assessment` header value.
 *
 * Base64 of the JSON: an HTTP header cannot carry 汉字, and a raw UTF-8
 * value would be mangled by the transport.
 *
 * HundredMark keeps the 0–100 scale a learner already understands;
 * Phoneme granularity is what lets the reply say which syllable failed;
 * EnableMiscue turns a skipped character into a miscue instead of letting
 * the recogniser quietly drop it.
 *
 * @param referenceText the word the learner was asked to read.
 * @param locale the language, default zh-CN.
 */
export function buildAssessmentHeader(referenceText: string, locale = 'zh-CN'): string {
  const payload = {
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    EnableMiscue: true,
    // Prosody needs BOTH the dimension and its own flag: without them Azure
    // leaves ProsodyScore out of the reply entirely, and an intonation
    // mistake would score like a perfect reading.
    Dimension: 'Comprehensive',
    EnableProsodyAssessment: true,
    Locale: locale,
  };
  const json = JSON.stringify(payload);
  // btoa cannot take non-ASCII; TextEncoder + manual base64 keeps the
  // Chinese intact on both Node and the browser.
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The endpoint for one-shot pronunciation assessment. */
export function assessmentUrl(region: string): string {
  return `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;
}

/**
 * The token endpoint — the cheapest way to prove the credentials work.
 *
 * It authenticates and hands back a token; it takes no audio, so verifying
 * costs nothing and sends nobody's voice anywhere.
 */
export function speechTokenUrl(region: string): string {
  return `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
}

/** What a credential test concluded. */
export interface VerifyResult {
  ok: boolean;
  /** null when ok; the failure class otherwise. */
  reason: SpeechFailure | null;
  /** A sentence for the operator; '' when ok. */
  message: string;
}

/**
 * Test the region + key against Azure without scoring anything.
 *
 * @param config the pair an operator just saved.
 */
export async function verifySpeechCredentials(config: SpeechConfig): Promise<VerifyResult> {
  const region = (config.region ?? '').trim();
  const key = (config.key ?? '').trim();
  if (region === '' || key === '') {
    return { ok: false, reason: 'unconfigured', message: describeConfigState(null) };
  }

  let response: Response;
  try {
    response = await fetch(speechTokenUrl(region), {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Length': '0',
      },
    });
  } catch (error) {
    console.error('[azure-speech] the credential test could not be sent', error);
    return {
      ok: false,
      reason: 'upstream',
      message: '连不上 Azure（网络或代理问题）。密钥没有验证过，请稍后再试。',
    };
  }

  if (response.ok) return { ok: true, reason: null, message: '' };

  const reason = classifySpeechFailure(response.status);
  // A 401 is the one case where the message must name BOTH values: the
  // region and the key are pasted from the same portal page, and a wrong
  // region produces exactly the same 401 as a wrong key.
  const message =
    reason === 'auth'
      ? `Azure 拒绝了这组凭据：region（${region}）与 key 至少要改一个。请核对资源所在区域与「密钥和终结点」页。`
      : describeFailureForOperator(reason);
  console.error(`[azure-speech] credential test failed with ${response.status}`);
  return { ok: false, reason, message };
}

/**
 * The operator-facing sentence for a classified failure.
 *
 * Separate from the learner-facing one in `azure-assessment`: an operator
 * needs to know WHICH value to change, a learner needs to know whether to
 * retry. Reusing one message for both is how a form ends up telling a
 * student to "check the region".
 */
function describeFailureForOperator(reason: SpeechFailure): string {
  switch (reason) {
    case 'unconfigured':
      return describeConfigState(null);
    case 'auth':
      return 'Azure 拒绝了这组凭据：region 与 key 至少要改一个。';
    case 'rate-limit':
      return 'Azure 暂时限流，凭据本身没问题，请过一分钟再试。';
    case 'bad-request':
      return '请求被 Azure 拒绝（通常是 region 格式不对）。region 只写区域代码。';
    case 'upstream':
      return 'Azure 服务暂时不可用，请稍后再试。';
    case 'unknown':
      return '测试没有成功，原因不明。请稍后再试。';
  }
}
