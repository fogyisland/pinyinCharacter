// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 顶部导航必须是一行。
 *
 * 用户看到的症状：在 1440 宽的屏幕上，导航也换行 —— 「留言笔记」掉到第二
 * 行。原因是这一行同时装着 logo（97px）、10 个链接（512px + 9 个「·」分隔
 * 点 ≈108px）、以及右侧控件（357px），在 `max-w-6xl`（1152px）里装不下。
 *
 * 修法不是「少放几个入口」（那会让教学功能藏起来），而是把这一行的像素
 * 预算挤出来：
 *
 *   1. 去掉「·」分隔点，改用组间距 —— 9 个点就是 108px；
 *   2. 「注册」从顶栏移进登录页与移动端抽屉 —— 28px，且登录页本来就有；
 *   3. 儿童模式的文字标签在窄屏收成图标 —— 100px。
 *
 * 这个测试钉住的是「素材」：导航的项数、分隔点的缺席、以及断点。真实
 * 的一行与否由 `.tmp/probe-header-nav.mjs` 在各宽度实测（768→1920 全部
 * `rows=1`）。
 */
const HEADER = readFileSync(join(process.cwd(), 'components', 'Header.tsx'), 'utf-8');
const SAFE = readFileSync(join(process.cwd(), 'components', 'SafeModeToggle.tsx'), 'utf-8');

describe('the header row', () => {
  it('does not let the nav wrap', () => {
    // `flex-wrap` 是换行的直接原因：去掉它，链接只会被压缩而不会掉行，
    // 而 `justify-center` + `min-w-0` 让压缩有地方发生。
    expect(HEADER).not.toContain('flex-wrap');
  });

  it('drops the dot separators, which cost ~108px', () => {
    // 9 个「·」= 108px，正好是「留言笔记」掉行的差额。
    expect(HEADER).not.toContain('<span aria-hidden="true" className="px-1 text-ink-faint/50 select-none">');
  });

  it('shows the full nav only from the large breakpoint and uses the drawer below it', () => {
    // lg = 1024px。1024 实测 navW=705 / 剩余 1024，仍然是一行。
    expect(HEADER).toMatch(/hidden lg:flex/);
    expect(HEADER).toMatch(/lg:hidden[\s\S]{0,200}打开菜单/);
  });

  it('keeps the register link out of the header row', () => {
    // 注册在登录页和移动端抽屉里都有；顶栏那一份是纯像素成本。
    const headerBlock = HEADER.slice(HEADER.indexOf('<header'), HEADER.indexOf('{mobileOpen &&'));
    expect(headerBlock).not.toContain('href="/register"');
  });

  it('keeps the children-mode words only on wide screens', () => {
    // 「🔒 儿童模式」的 100px 标签在窄屏收成一个锁图标。
    expect(SAFE).toMatch(/hidden xl:inline text-sm/);
    expect(SAFE).toMatch(/xl:hidden text-sm[^>]*aria-hidden/);
  });

  it('keeps the switch accessible without its visible label', () => {
    // 收成图标之后，开关自己要有 aria-label，否则读屏软件只看到「开关」。
    expect(SAFE).toContain('aria-label="儿童模式"');
  });
});
