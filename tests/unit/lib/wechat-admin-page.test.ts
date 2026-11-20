import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

describe('the WeChat admin screen', () => {
  it('has a page', () => {
    expect(existsSync(join(ROOT, 'app/admin/wechat/page.tsx'))).toBe(true);
  });

  it('has a configuration form', () => {
    expect(existsSync(join(ROOT, 'components/admin/WechatConfigForm.tsx'))).toBe(true);
  });

  it('has an announcement form', () => {
    expect(existsSync(join(ROOT, 'components/admin/WechatBroadcastForm.tsx'))).toBe(true);
  });

  it('has an announcement table', () => {
    expect(existsSync(join(ROOT, 'components/admin/WechatBroadcastTable.tsx'))).toBe(true);
  });

  it('is in the admin sidebar', () => {
    const sidebar = read('components/admin/AdminSidebar.tsx');
    expect(sidebar).toContain('/admin/wechat');
    expect(sidebar).toContain('微信公众号');
  });

  it('reuses an icon that is already imported', () => {
    const sidebar = read('components/admin/AdminSidebar.tsx');
    const iconMatch = sidebar.match(/href: '\/admin\/wechat', label: '[^']+',[^}]*icon: (\w+)/);
    expect(iconMatch).not.toBeNull();
    const iconName = iconMatch![1];
    expect(sidebar).toContain(`\n  ${iconName},`);
  });

  it('uses the shared header and panel — the admin layout already has the sidebar', () => {
    const source = read('app/admin/wechat/page.tsx');
    expect(source).toContain('PageHeader');
    expect(source).toContain('Panel');
    expect(source).not.toContain('AdminSidebar');
    expect(source).not.toContain('<h1');
  });

  it('reads the rows on the server and passes them down', () => {
    const source = read('app/admin/wechat/page.tsx');
    expect(source).toContain('listBroadcasts');
    expect(source).toContain('initialBroadcasts');
  });

  it('actually calls listBroadcasts — the import alone is not a read', () => {
    // ⚠️ `toContain('listBroadcasts')` is satisfied by the import line on
    // its own, so a page that imported the function and never called it
    // would pass. The rows have to come from the server: the client
    // cannot read the table, and a server render with no rows shows an
    // empty history until a fetch the page never makes.
    const source = read('app/admin/wechat/page.tsx');
    expect(source).toMatch(/await listBroadcasts\(\)/);
    expect(source).toMatch(/initialBroadcasts=\{broadcasts\}/);
  });

  it('does not promise delivery — WeChat gives no delivery receipt', () => {
    const files = [
      'app/admin/wechat/page.tsx',
      'components/admin/WechatBroadcastTable.tsx',
      'components/admin/WechatConfigForm.tsx',
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toContain('已送达');
      expect(source).not.toContain('送达成功');
    }
  });

  it('says that the count is what the platform accepted', () => {
    const source = read('components/admin/WechatBroadcastTable.tsx');
    expect(source).toContain('平台接受');
  });

  it('labels the column itself as accepted, not as delivered', () => {
    // ⚠️ The paragraph below the table also says 平台接受, so a plain
    // `toContain` over the file is satisfied by either one. The column
    // header is the thing a reader scans, so it is the thing that must
    // carry the honest word.
    const source = read('components/admin/WechatBroadcastTable.tsx');
    expect(source).toMatch(/<th[^>]*>平台接受<\/th>/);
    expect(source).not.toMatch(/<th[^>]*>[^<]*送达[^<]*<\/th>/);
  });

  it('warns about the server IP whitelist', () => {
    const source = read('components/admin/WechatConfigForm.tsx');
    expect(source).toContain('IP');
    expect(source).toContain('白名单');
  });

  it('warns when there are no followers', () => {
    const source = read('components/admin/WechatConfigForm.tsx');
    expect(source).toContain('关注者');
  });

  it('warns about zero followers — the label alone is not a warning', () => {
    // ⚠️ The count's own label says 关注者, so a plain `toContain` over the
    // file is satisfied by the label. The warning that matters is the one
    // that fires when the count is zero, because an announcement to
    // nobody reads as a broken send rather than an empty audience.
    const source = read('components/admin/WechatConfigForm.tsx');
    expect(source).toMatch(/followerCount === 0/);
    expect(source).toMatch(/还没有关注者/);
  });
});
