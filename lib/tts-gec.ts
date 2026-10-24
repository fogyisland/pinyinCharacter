import { createHash } from 'node:crypto';

/**
 * Microsoft Edge 在线朗读服务的握手鉴权令牌 `Sec-MS-GEC` 生成器。
 *
 * ## 令牌算法
 *
 * 令牌 = SHA-256(「5 分钟对齐的 Windows FILETIME 计数」+ 「固定客户端令牌」)，
 * 结果取大写十六进制。服务端按 5 分钟窗口校验，窗口外的令牌一律拒绝。
 *
 * ## 端点与版本前缀（2026-10 实测结论）
 *
 * 微软在 2026-10-12 起把 `speech.platform.bing.com` 的握手升级为 v2 令牌
 * （`Sec-MS-GEC-Version: 2-<chromium 版本>`，令牌形如 `<16 位十六进制>-<64 位十六进制>`），
 * 旧版 v1 令牌在该主机上一律被拒（HTTP 403）。目前实测：
 *
 * | 端点 | 参数名 | 版本前缀 | 令牌算法 | 结果 |
 * | --- | --- | --- | --- | --- |
 * | `speech.platform.bing.com/.../edge/v1` | `TrustedClientToken` | `1-` / `2-` | v1 / v2 | 全部 403 |
 * | `api.msedgeservices.com/.../websocket/v1` | `Ocp-Apim-Subscription-Key` | `2-` | v2 | 403 |
 * | `api.msedgeservices.com/.../websocket/v1` | `Ocp-Apim-Subscription-Key` | `1-` | v1 | **握手成功，可正常合成** |
 *
 * 服务端会交叉校验「版本前缀 ↔ 令牌算法」：用 `1-` 前缀配 v2 令牌、或用 `2-`
 * 前缀配 v1 令牌，都会被 403。因此本项目固定使用 `api.msedgeservices.com` +
 * `1-` 前缀 + v1 令牌这一组。
 *
 * 参考实现：上游 Python 客户端 edge-tts 7.2.x（LGPL-3.0）的 `drm.py`；
 * 7.3.x 引入的 v2 算法（CS64 + 定制 SHA-256）在本机实测同样被服务端拒绝，
 * 故此处只保留已验证可用的 v1 算法。
 */

/** Edge 在线朗读服务使用的固定客户端令牌。 */
export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

/** Chromium 版本号。服务端据此判断客户端协议代次。 */
export const CHROMIUM_FULL_VERSION = '143.0.3650.75';

/** 握手版本前缀。`1-` 对应 v1（普通 SHA-256）令牌。 */
export const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

/** Windows FILETIME 纪元（秒）相对 Unix 纪元的偏移量。 */
const WIN_EPOCH_SECONDS = 11644473600;

/** 令牌时间窗：5 分钟（与服务端校验窗口一致）。 */
const TICK_WINDOW_SECONDS = 300;

/** FILETIME 计数单位：100 纳秒，即 1 秒 = 1e7 个计数。 */
const TICKS_PER_SECOND = 10_000_000n;

/**
 * 计算令牌使用的 FILETIME 计数（向下对齐到 5 分钟窗口）。
 *
 * 用 BigInt 精确计算：计数量级约 1.3e17，已超出双精度浮点 53 位尾数的安全
 * 范围，浮点乘法会丢精度。秒级部分先取整再对齐，保证结果是 300 秒的整数倍。
 */
export function tokenTicks(unixTimestamp: number): bigint {
  const seconds = Math.floor(unixTimestamp + WIN_EPOCH_SECONDS);
  const aligned = seconds - (seconds % TICK_WINDOW_SECONDS);
  return BigInt(aligned) * TICKS_PER_SECOND;
}

/**
 * 生成 `Sec-MS-GEC` 令牌（大写十六进制的 SHA-256）。
 *
 * @param unixTimestamp Unix 时间戳（秒）。默认取当前时间。
 */
export function generateSecMsGec(unixTimestamp: number = Date.now() / 1000): string {
  const payload = `${tokenTicks(unixTimestamp)}${TRUSTED_CLIENT_TOKEN}`;
  return createHash('sha256').update(payload, 'ascii').digest('hex').toUpperCase();
}
