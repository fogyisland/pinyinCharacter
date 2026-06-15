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
  { href: '/pinyin', label: '字转拼音' },
  { href: '/poetry', label: '诗词' },
  { href: '/sutra', label: '佛经' },
  { href: '/game', label: '游戏' },
  { href: '/profile', label: '我的' },
] as const;

export const FOOTER_LINKS = [
  { href: '/about', label: '关于' },
  { href: '/guide', label: '使用指南' },
  { href: 'https://github.com/your/repo', label: 'GitHub', external: true },
  { href: '/feedback', label: '反馈' },
] as const;
