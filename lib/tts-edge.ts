import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { generateSecMsGec, SEC_MS_GEC_VERSION, TRUSTED_CLIENT_TOKEN } from './tts-gec';

/**
 * Edge 在线朗读服务（WebSocket 协议）的最小自实现。
 *
 * 早期版本依赖 npm 包 `edge-tts-universal`，但该包停留在已被微软下线的 v1
 * 握手令牌算法上：2026-10-12 起微软把 WebSocket 升级阶段的鉴权换成了 v2
 * 令牌，握手直接返回 HTTP 403，而该包把这个 403 表现成「Edge TTS timeout」，
 * 最终在 `/api/tts` 变成一个语焉不详的 500。
 *
 * 这里改为直接对接 WebSocket 协议（与上游 edge-tts 的报文格式一致）：
 *
 * 1. 握手：把 `Sec-MS-GEC` 令牌放进 query，`Sec-MS-GEC-Version` 标明协议代次。
 * 2. `speech.config` 文本帧：声明输出音频格式。
 * 3. `ssml` 文本帧：提交待朗读文本。
 * 4. 二进制帧：2 字节大端头部长度 + 头部文本 + 音频负载，`Path:audio` 的帧是音频。
 * 5. `turn.end` 文本帧：本次合成结束。
 *
 * 端点与令牌算法的取舍见 `lib/tts-gec.ts` 的注释。
 */

/** Edge 在线朗读服务支持的音频格式。 */
export type AudioFormat =
  | 'audio-24khz-48kbitrate-mono-mp3'
  | 'audio-24khz-96kbitrate-mono-mp3'
  | 'audio-16khz-32kbitrate-mono-mp3'
  | 'audio-16khz-128kbitrate-mono-mp3';

export interface SynthesizeOpts {
  /** 音色名，例如 `zh-CN-XiaoxiaoNeural`。 */
  voiceName: string;
  /** 待朗读文本。 */
  text: string;
  /** 输出音频格式，默认 24kHz / 48kbps 单声道 MP3。 */
  format?: AudioFormat;
  /** 整体超时（毫秒），默认 25 秒。 */
  timeoutMs?: number;
}

/** 失败分类，供上层映射成合适的 HTTP 状态码。 */
export type TtsFailureReason = 'auth' | 'timeout' | 'protocol' | 'network';

/** 合成失败时抛出的结构化错误。 */
export class TtsUpstreamError extends Error {
  /** 失败分类。 */
  readonly reason: TtsFailureReason;
  /** 上游返回的 HTTP 状态码（仅握手阶段失败时有值）。 */
  readonly upstreamStatus: number | null;

  constructor(message: string, reason: TtsFailureReason, upstreamStatus: number | null = null) {
    super(message);
    this.name = 'TtsUpstreamError';
    this.reason = reason;
    this.upstreamStatus = upstreamStatus;
  }
}

/** WebSocket 端点（`api.msedgeservices.com` 的朗读通道）。 */
const WS_BASE_URL = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1';

/** 端点要求的客户端令牌参数名。 */
const TOKEN_PARAM = 'Ocp-Apim-Subscription-Key';

/** 伪装成 Edge 浏览器扩展发起的请求。 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

/** 朗读扩展的 Origin。 */
const ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';

/** 握手阶段的超时（毫秒）。 */
const HANDSHAKE_TIMEOUT_MS = 12_000;

/** 合成整体超时（毫秒）。 */
const DEFAULT_TIMEOUT_MS = 25_000;

/** 写日志到 stderr（服务端无 console 收集器时也能看到排查信息）。 */
function logTts(message: string, detail?: unknown): void {
  const suffix = detail instanceof Error ? `：${detail.message}` : '';
  process.stderr.write(`[tts-edge] ${message}${suffix}\n`);
}

/** 32 位十六进制随机串，用作连接 ID / 请求 ID。 */
function randomHexId(): string {
  return randomBytes(16).toString('hex');
}

/** 32 位十六进制大写随机串，用作 MUID（微软新版接口要求带上）。 */
function buildMuid(): string {
  return randomBytes(16).toString('hex').toUpperCase();
}

/** 拼出带鉴权参数的 WebSocket 地址。 */
export function buildWsUrl(secMsGec: string, connectionId: string): string {
  return (
    `${WS_BASE_URL}?${TOKEN_PARAM}=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
    `&ConnectionId=${connectionId}`
  );
}

/** 转义 XML 文本节点里的特殊字符。 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 从音色名推断朗读语言（`zh-CN-XiaoxiaoNeural` → `zh-CN`）。 */
function localeFromVoice(voiceName: string): string {
  const parts = voiceName.split('-');
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'zh-CN';
}

/** 构造 SSML 正文。 */
export function buildSsml(voiceName: string, text: string): string {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${localeFromVoice(voiceName)}'>` +
    `<voice name='${escapeXml(voiceName)}'>` +
    `<prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`
  );
}

/** 构造 `speech.config` 文本帧。 */
function buildSpeechConfigMessage(format: AudioFormat): string {
  const payload = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: 'false',
            wordBoundaryEnabled: 'false',
          },
          outputFormat: format,
        },
      },
    },
  });
  return (
    `X-Timestamp:${new Date().toString()}\r\n` +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    payload
  );
}

/** 构造 `ssml` 文本帧。 */
function buildSsmlMessage(requestId: string, ssml: string): string {
  return (
    `X-Timestamp:${new Date().toString()}\r\n` +
    `X-RequestId:${requestId}\r\n` +
    'Content-Type:application/ssml+xml\r\n' +
    'Path:ssml\r\n\r\n' +
    ssml
  );
}

/** 从头部文本中取出某个字段的值。 */
function extractHeaderValue(headers: string, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const line of headers.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    if (line.slice(0, separator).trim().toLowerCase() === wanted) {
      return line.slice(separator + 1).trim();
    }
  }
  return null;
}

/** 文本帧的解析结果。 */
interface TextMessage {
  path: string;
  body: string;
}

/** 解析文本帧（头部 + 空行 + 正文）。 */
function parseTextMessage(raw: string): TextMessage {
  const separator = raw.indexOf('\r\n\r\n');
  const headerText = separator === -1 ? raw : raw.slice(0, separator);
  const body = separator === -1 ? '' : raw.slice(separator + 4);
  return { path: extractHeaderValue(headerText, 'Path') ?? '', body };
}

/** 二进制帧的解析结果。 */
interface BinaryFrame {
  path: string;
  payload: Buffer;
}

/**
 * 解析二进制帧：2 字节大端头部长度 + 头部文本 + 负载。
 *
 * 流结束时会收到一个「无 Content-Type、无数据」的空帧，属于正常情况。
 */
function parseBinaryFrame(data: Buffer): BinaryFrame | null {
  if (data.length < 2) return null;
  const headerLength = data.readUInt16BE(0);
  if (2 + headerLength > data.length) {
    throw new TtsUpstreamError('上游二进制帧的头部长度非法', 'protocol');
  }
  const headerText = data.subarray(2, 2 + headerLength).toString('utf8');
  const path = extractHeaderValue(headerText, 'Path') ?? '';
  const payload = data.subarray(2 + headerLength);
  if (payload.length === 0) return null;
  return { path, payload: Buffer.from(payload) };
}

/**
 * 把文本合成为 MP3 音频。
 *
 * 失败时抛出 {@link TtsUpstreamError}，其中的 `reason` 供上层决定 HTTP 状态码：
 * `auth` → 上游拒绝握手，`timeout` → 超时，`protocol` → 报文异常，`network` → 连接失败。
 */
export async function synthesize(opts: SynthesizeOpts): Promise<Buffer> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const format = opts.format ?? 'audio-24khz-48kbitrate-mono-mp3';
  const text = opts.text.trim();

  if (!text) {
    throw new TtsUpstreamError('待朗读文本为空', 'protocol');
  }

  const requestId = randomHexId();
  const url = buildWsUrl(generateSecMsGec(), randomHexId());

  return new Promise<Buffer>((resolve, reject) => {
    const audioChunks: Buffer[] = [];
    let settled = false;

    const ws = new WebSocket(url, {
      origin: ORIGIN,
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
      perMessageDeflate: false,
      headers: {
        'User-Agent': USER_AGENT,
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: ORIGIN,
        Cookie: `muid=${buildMuid()};`,
      },
    });

    const timer = setTimeout(() => {
      fail(new TtsUpstreamError(`Edge TTS 合成超时（${timeoutMs}ms）`, 'timeout'));
    }, timeoutMs);

    /** 正常结束：返回音频。 */
    function succeed(buffer: Buffer): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch (error) {
        logTts('关闭连接失败', error);
      }
      resolve(buffer);
    }

    /** 异常结束：抛出结构化错误。 */
    function fail(error: TtsUpstreamError): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch (terminateError) {
        logTts('断开连接失败', terminateError);
      }
      logTts(`合成失败：${error.message}`);
      reject(error);
    }

    ws.on('open', () => {
      ws.send(buildSpeechConfigMessage(format), (configError) => {
        if (configError) {
          fail(new TtsUpstreamError(`发送合成配置失败：${configError.message}`, 'network'));
          return;
        }
        const ssmlMessage = buildSsmlMessage(requestId, buildSsml(opts.voiceName, text));
        ws.send(ssmlMessage, (ssmlError) => {
          if (ssmlError) {
            fail(new TtsUpstreamError(`发送朗读文本失败：${ssmlError.message}`, 'network'));
          }
        });
      });
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      try {
        if (isBinary) {
          const frame = parseBinaryFrame(data);
          if (frame && frame.path === 'audio') audioChunks.push(frame.payload);
          return;
        }
        const message = parseTextMessage(data.toString('utf8'));
        if (message.path !== 'turn.end') return;
        const buffer = Buffer.concat(audioChunks);
        if (buffer.length === 0) {
          fail(new TtsUpstreamError('上游没有返回任何音频', 'protocol'));
          return;
        }
        succeed(buffer);
      } catch (error) {
        fail(
          error instanceof TtsUpstreamError
            ? error
            : new TtsUpstreamError('解析上游数据失败', 'protocol'),
        );
      }
    });

    ws.on('unexpected-response', (_request, response) => {
      // 握手被拒（例如 403）：响应体不是 WebSocket 帧，读掉即可。
      response.resume();
      const status = response.statusCode ?? 0;
      const reason: TtsFailureReason = status === 401 || status === 403 ? 'auth' : 'protocol';
      fail(new TtsUpstreamError(`上游握手被拒：HTTP ${status}`, reason, status));
    });

    ws.on('error', (error: Error) => {
      fail(new TtsUpstreamError(`连接上游失败：${error.message}`, 'network'));
    });

    ws.on('close', (code: number) => {
      fail(new TtsUpstreamError(`上游连接意外关闭（code=${code}）`, 'protocol'));
    });
  });
}
