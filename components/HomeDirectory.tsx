'use client';

import Link from 'next/link';
import { filterNavLinks, NAV_GROUPS, type NavItem, type NavGroupId } from '@/lib/design';
import { useAppStore } from '@/lib/store';

const supplements: Partial<Record<NavGroupId, NavItem[]>> = {
  dictionary: [{ href: '/stories', label: '汉字故事' }],
};

export function HomeDirectory() {
  const safeMode = useAppStore((state) => state.safeMode);
  const user = useAppStore((state) => state.user);
  const links = filterNavLinks(safeMode);
  const groups = (Object.keys(NAV_GROUPS) as NavGroupId[]).map((id) => ({
    title: NAV_GROUPS[id].label,
    items: [...links.filter((link) => link.group === id), ...(supplements[id] ?? [])].map(
      (item) => ({
        ...item,
        href: item.href === '/culture' ? '/culture#culture-index' : item.href,
      }),
    ),
  }));
  const account = user
    ? [
        { href: '/profile', label: '个人中心' },
        { href: '/history', label: '转换历史与收藏' },
        { href: '/worksheet/history', label: '我的字帖' },
      ]
    : [
        { href: '/login', label: '登录个人中心' },
        { href: '/register', label: '注册账号' },
      ];
  groups.push({
    title: '站务与账户',
    items: [
      ...account,
      { href: '/membership', label: '会员服务' },
      { href: '/guide', label: '使用指南' },
      { href: '/about', label: '关于字韵' },
    ],
  });
  return (
    <nav aria-label="全站目录">
      <dl className="divide-y divide-ink/15">
        {groups.map((group) => (
          <div
            key={group.title}
            className="grid gap-x-4 py-2 sm:grid-cols-[7.5rem_1fr] sm:items-baseline"
          >
            <dt className="font-kai text-2xl text-ink">{group.title}</dt>
            <dd className="flex flex-wrap gap-x-5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  className="inline-flex min-h-11 items-center text-ink-soft hover:text-seal hover:underline underline-offset-4"
                  href={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </nav>
  );
}
