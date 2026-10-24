import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  TRUSTED_CLIENT_TOKEN,
  SEC_MS_GEC_VERSION,
  CHROMIUM_FULL_VERSION,
  generateSecMsGec,
  tokenTicks,
} from '@/lib/tts-gec';

const WIN_EPOCH_SECONDS = 11644473600;

describe('tokenTicks()', () => {
  it('向下对齐到 5 分钟窗口', () => {
    // 1793000000 + WIN_EPOCH = 13437473400，本身就是 300 的整数倍。
    const aligned = tokenTicks(1793000000);
    expect(aligned % (300n * 10_000_000n)).toBe(0n);
  });

  it('同一窗口内的时间戳得到相同计数', () => {
    // 窗口边界是 Unix 时间 [1792999800, 1793000099]（偏移量不是 300 的整数倍）。
    const base = tokenTicks(1793000000);
    expect(tokenTicks(1792999800)).toBe(base);
    expect(tokenTicks(1793000000.999)).toBe(base);
    expect(tokenTicks(1793000001)).toBe(base);
    expect(tokenTicks(1793000099)).toBe(base);
  });

  it('跨过 5 分钟边界后计数改变', () => {
    expect(tokenTicks(1793000100)).not.toBe(tokenTicks(1793000099));
  });

  it('使用 BigInt 精确表示，不丢精度', () => {
    // 计数约 1.34e17，超出双精度浮点 53 位尾数的安全范围。
    const ticks = tokenTicks(1793000000);
    expect(typeof ticks).toBe('bigint');
    expect(ticks.toString()).toBe('134374734000000000');
  });
});

describe('generateSecMsGec()', () => {
  it('输出 64 位大写十六进制', () => {
    const token = generateSecMsGec(1793000000);
    expect(token).toMatch(/^[0-9A-F]{64}$/);
  });

  it('等于 SHA-256(对齐计数 + 固定客户端令牌)', () => {
    const timestamp = 1793000123.456;
    const expected = createHash('sha256')
      .update(`${tokenTicks(timestamp)}${TRUSTED_CLIENT_TOKEN}`, 'ascii')
      .digest('hex')
      .toUpperCase();
    expect(generateSecMsGec(timestamp)).toBe(expected);
  });

  it('固定时间戳的令牌是稳定值（回归基线）', () => {
    expect(generateSecMsGec(1793000000)).toBe(
      'AE925E94F448BD647BE4E6608199F12EE9766E79B2CF76024F3C9CF97B3C2C91',
    );
    expect(generateSecMsGec(1793000123.456)).toBe(
      'E1AF34E254449BFE4C039C07DE5D1FBEBB1E62B057710858976713D6967FF822',
    );
  });

  it('同一时间戳可重复生成', () => {
    expect(generateSecMsGec(1793000000)).toBe(generateSecMsGec(1793000000));
  });

  it('默认使用当前时间', () => {
    const token = generateSecMsGec();
    expect(token).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe('握手常量', () => {
  it('版本前缀与 Chromium 版本一致', () => {
    expect(SEC_MS_GEC_VERSION).toBe(`1-${CHROMIUM_FULL_VERSION}`);
  });

  it('客户端令牌是 32 位十六进制', () => {
    expect(TRUSTED_CLIENT_TOKEN).toMatch(/^[0-9A-F]{32}$/);
  });

  it('FILETIME 纪元偏移固定为 11644473600 秒', () => {
    expect(WIN_EPOCH_SECONDS).toBe(11644473600);
  });
});
