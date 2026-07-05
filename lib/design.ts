export const BRAND = {
  name: '字·韵',
  namePlain: '字韵',
  tagline: '汉字与拼音，一笔一画皆有意',
  shortDesc: '公益汉字工具，免费使用',
  copyright: '© 2026 字韵项目 · MIT License',
} as const;

export type NavItem = { href: string; label: string };

export type NavGroup = {
  /** Chinese numeral prefix — distinctive on-brand section marker (壹/贰/叁/肆/伍). */
  numeral: string;
  /** Top-level label shown in the nav (e.g. 字典). */
  label: string;
  /** 1 item → render as plain link; ≥2 → render with dropdown. */
  items: readonly NavItem[];
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    numeral: '壹',
    label: '字典',
    items: [
      { href: '/dictionary', label: '字典' },
      { href: '/rare-chars', label: '罕见字库' },
      { href: '/pinyin', label: '字转拼音' },
    ],
  },
  {
    numeral: '贰',
    label: '字帖',
    items: [
      { href: '/worksheet', label: '字帖' },
      { href: '/worksheet/practice', label: '练字模板' },
    ],
  },
  {
    numeral: '叁',
    label: '诗词',
    items: [
      { href: '/poetry', label: '诗词' },
      { href: '/ancient', label: '古籍' },
      { href: '/sutra', label: '佛经' },
    ],
  },
  {
    numeral: '肆',
    label: '游戏',
    items: [{ href: '/game', label: '游戏' }],
  },
  {
    numeral: '伍',
    label: '留言笔记',
    items: [{ href: '/notes', label: '留言笔记' }],
  },
] as const;

/**
 * Children-mode hides 古籍/佛经 (adult-classical content). When filter
 * drops all items in a group, the group itself is omitted (so the user
 * doesn't see an empty section header).
 */
export function filterNavGroups(safeMode: boolean): readonly NavGroup[] {
  if (!safeMode) return NAV_GROUPS;
  return NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.href !== '/sutra' && i.href !== '/ancient'),
    }))
    .filter((g) => g.items.length > 0);
}

export const GITHUB_REPO_URL = 'https://github.com/fogyisland/pinyinCharacter';
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;
export const GITHUB_NEW_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new`;

export const FOOTER_LINKS = [
  { href: '/about', label: '关于' },
  { href: '/guide', label: '使用指南' },
  { href: GITHUB_REPO_URL, label: 'GitHub', external: true },
  { href: GITHUB_ISSUES_URL, label: '反馈', external: true },
] as const;
