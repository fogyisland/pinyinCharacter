// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * 401 的文案 —— 为什么默认值不够用。
 *
 * `unauthorized()` 的默认 message 是英文单词 `unauthorized`。那是给运维读的，
 * 不是给学生读的；而班级页会把 `error.message` 直接渲染成界面上的那行红字。
 * 会话过期是学生最常遇到的状态，所以它必须是一句**中文、告诉他下一步怎么做**
 * 的话，而且全站保持一致 —— 十一个路由各写一句，就会出现十一种说法。
 */

import { LOGIN_REQUIRED_MESSAGE, unauthorized, unauthorizedForLogin } from '@/lib/api-handler';

async function bodyOf(response: Response): Promise<{ ok: boolean; error: { code: string; message: string } }> {
  return (await response.json()) as { ok: boolean; error: { code: string; message: string } };
}

describe('unauthorizedForLogin', () => {
  it('answers 401', () => {
    expect(unauthorizedForLogin().status).toBe(401);
  });

  it('says what to do, in Chinese', () => {
    // The learner sees this sentence as-is; English would be a mystery.
    expect(LOGIN_REQUIRED_MESSAGE).toContain('登录');
    expect(LOGIN_REQUIRED_MESSAGE).not.toMatch(/[a-z]/i);
  });

  it('keeps the machine-readable code stable', async () => {
    // The code stays `unauthorized`: the panel and the tests branch on it,
    // and only the human sentence changed.
    const body = await bodyOf(unauthorizedForLogin());
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthorized');
    expect(body.error.message).toBe(LOGIN_REQUIRED_MESSAGE);
  });

  it('leaves the generic unauthorized() alone', async () => {
    // Not every caller is user-facing: an API consumer may want the plain
    // contract, so the default must not be rewritten under it.
    const body = await bodyOf(unauthorized());
    expect(body.error.message).toBe('unauthorized');
  });
});
