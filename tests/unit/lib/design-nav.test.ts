// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, NAV_LINKS, filterNavLinks } from '@/lib/design';

/**
 * 顶部导航的结构约束。
 *
 * 站点的导航是**扁平**的（不嵌套下拉），所以每加一项都要问三个问题：
 * 1. 它属于哪个分组（同组用「·」紧挨，组间留宽一点的间隙）；
 * 2. 儿童模式要不要藏它；
 * 3. 总项数有没有失控。
 *
 * 这三条钉在这里，避免「加了一个页面顺手加了导航但忘了分组」。
 */
describe('the header navigation', () => {
  it('keeps every link inside a declared group', () => {
    const groups = new Set(Object.keys(NAV_GROUPS));
    for (const link of NAV_LINKS) {
      expect(groups.has(link.group), `${link.label} has group ${link.group}`).toBe(true);
    }
  });

  it('keeps the group order meaningful (teaching right after learning tools)', () => {
    // 分组在 NAV_LINKS 里的出现顺序就是渲染顺序：先字典，再学习工具，
    // 再诗词，再教学，最后游戏与留言。
    const seen: string[] = [];
    for (const link of NAV_LINKS) {
      if (seen[seen.length - 1] !== link.group) seen.push(link.group);
    }
    expect(seen).toEqual(['dictionary', 'prosody', 'classics', 'culture', 'worksheet', 'teach', 'game', 'feedback']);
  });

  it('has no duplicate hrefs', () => {
    const hrefs = NAV_LINKS.map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('keeps eight top-level groups and exposes the new learning destinations', () => {
    expect(Object.keys(NAV_GROUPS)).toHaveLength(8);
    expect(NAV_LINKS.map(link => link.href)).toEqual(expect.arrayContaining(['/prosody', '/culture', '/idioms', '/calligraphy']));
  });

  it('offers the classroom page and the dictation tool in the header', () => {
    // 这两项是「能带班上课」的入口，藏在下拉或页面深处等于没有。
    const hrefs = NAV_LINKS.map((link) => link.href);
    expect(hrefs).toContain('/classes');
    expect(hrefs).toContain('/dictation');
  });

  it('hides the adult-classical pages in children mode', () => {
    const safe = filterNavLinks(true);
    expect(safe.map((link) => link.href)).not.toContain('/sutra');
    expect(safe.map((link) => link.href)).not.toContain('/ancient');
    // 班级与听写是给老师用的，儿童模式不该动它们。
    expect(safe.map((link) => link.href)).toContain('/classes');
    expect(safe.map((link) => link.href)).toContain('/dictation');
  });

  it('shows everything when children mode is off', () => {
    expect(filterNavLinks(false)).toEqual(NAV_LINKS);
  });
});
