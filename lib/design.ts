export const BRAND = {
  name: '字·韵',
  namePlain: '字韵',
  tagline: '汉字与拼音，一笔一画皆有意',
  shortDesc: '公益汉字工具，免费使用',
  copyright: '© 2026 字韵项目 · MIT License',
} as const;

export const NAV_LINKS = [
  { href: '/rare-chars', label: '罕见字库' },
  { href: '/dictionary', label: '字典' },
  { href: '/worksheet', label: '字帖' },
  { href: '/worksheet/practice', label: '练字模板' },
  { href: '/pinyin', label: '字转拼音' },
  { href: '/poetry', label: '诗词' },
  { href: '/sutra', label: '佛经' },
  { href: '/ancient', label: '古籍' },
  { href: '/game', label: '游戏' },
] as const;

export const GITHUB_REPO_URL = 'https://github.com/fogyisland/pinyinCharacter';
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;
export const GITHUB_NEW_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new`;

export const FOOTER_LINKS = [
  { href: '/about', label: '关于' },
  { href: '/guide', label: '使用指南' },
  { href: GITHUB_REPO_URL, label: 'GitHub', external: true },
  { href: GITHUB_ISSUES_URL, label: '反馈', external: true },
] as const;
