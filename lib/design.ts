export const BRAND = {
  name: '字·韵',
  namePlain: '字韵',
  tagline: '汉字与拼音，一笔一画皆有意',
  shortDesc: '公益汉字工具，免费使用',
  copyright: '© 2026 字韵项目 · MIT License',
} as const;

export type NavItem = { href: string; label: string };

/**
 * Visual grouping for the header nav. Items in the same group are separated
 * by "·" with tight spacing; groups are separated by a wider gap so the eye
 * reads each cluster as one section.
 */
export type NavGroupId = 'dictionary' | 'worksheet' | 'classics' | 'game' | 'feedback';

export const NAV_GROUPS: Readonly<Record<NavGroupId, { label: string }>> = {
  dictionary: { label: '字典' },
  worksheet: { label: '字帖' },
  classics: { label: '诗词' },
  game: { label: '游戏' },
  feedback: { label: '留言笔记' },
} as const;

export type NavLink = NavItem & { group: NavGroupId };

export const NAV_LINKS: readonly NavLink[] = [
  { group: 'dictionary', href: '/dictionary', label: '字典' },
  { group: 'dictionary', href: '/rare-chars', label: '罕见字库' },
  { group: 'dictionary', href: '/pinyin', label: '字转拼音' },
  { group: 'worksheet', href: '/worksheet', label: '字帖' },
  { group: 'worksheet', href: '/worksheet/practice', label: '练字模板' },
  { group: 'classics', href: '/poetry', label: '诗词' },
  { group: 'classics', href: '/ancient', label: '古籍' },
  { group: 'classics', href: '/sutra', label: '佛经' },
  { group: 'game', href: '/game', label: '游戏' },
  { group: 'feedback', href: '/notes', label: '留言笔记' },
] as const;

/**
 * Children-mode hides 古籍/佛经 (adult-classical content).
 */
export function filterNavLinks(safeMode: boolean): readonly NavLink[] {
  if (!safeMode) return NAV_LINKS;
  return NAV_LINKS.filter((i) => i.href !== '/sutra' && i.href !== '/ancient');
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
