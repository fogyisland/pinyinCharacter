import { describe, it, expect } from 'vitest';
import { filterUserReadme } from '@/app/guide/filter';

// 简化版 README 用来验证 blocklist 行为;真实 README 在 lib/email.ts 测试中已覆盖结构。
const SAMPLE = `# 字 ↔ 拼音 工具

项目描述段。这里写项目是干什么的。

## 功能

汉字转拼音。

## 启动

\`\`\`bash
pnpm install
\`\`\`

## 测试

\`\`\`bash
pnpm test
\`\`\`

## 技术栈

Next.js + MySQL。

## 账号系统

注册 / 登录。

## 密码找回 + 管理员后台

如何重置密码。

## 管理员后台扩展

后台管理用户。

## 罕见字库

罕见字。

## 环境变量

DATABASE_URL 必填。

## 路线图

v2 计划。
`;

describe('filterUserReadme', () => {
  it('removes 启动 section', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).not.toContain('## 启动');
    expect(out).not.toContain('pnpm install');
  });

  it('removes 测试 section', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).not.toContain('## 测试');
    expect(out).not.toContain('pnpm test');
  });

  it('removes 管理员后台扩展 section', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).not.toContain('## 管理员后台扩展');
    expect(out).not.toContain('后台管理用户');
  });

  it('removes admin sections even when README heading has a parenthetical suffix (matches real README)', () => {
    const real = `# 标题

intro

## 启动

stuff

## 管理员后台扩展（v1 / Plan H）

admin stuff

## 路线图

roadmap
`;
    const out = filterUserReadme(real);
    expect(out).not.toContain('## 管理员后台扩展');
    expect(out).not.toContain('admin stuff');
    expect(out).toContain('## 路线图'); // ensure startsWith doesn't break non-blocked sections
    // The literal '## 管理员后台扩展（v1 / Plan H）' heading is dropped.
  });

  it('removes 环境变量 section', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).not.toContain('## 环境变量');
    expect(out).not.toContain('DATABASE_URL 必填');
  });

  it('keeps 密码找回 + 管理员后台 section intact (users need to know how to reset password)', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).toContain('## 密码找回 + 管理员后台');
    expect(out).toContain('如何重置密码');
  });

  it('keeps H1 and earlier user sections intact', () => {
    const out = filterUserReadme(SAMPLE);
    expect(out).toContain('# 字 ↔ 拼音 工具');
    expect(out).toContain('项目描述段');
    expect(out).toContain('## 功能');
    expect(out).toContain('## 技术栈');
    expect(out).toContain('## 路线图');
  });
});
