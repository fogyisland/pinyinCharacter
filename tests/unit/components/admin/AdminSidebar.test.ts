import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_NAV_GROUPS, type NavItem } from '@/components/admin/AdminSidebar';

/**
 * The admin navigation.
 *
 * The sidebar is the map of the whole admin, and a map with a wrong entry
 * sends the operator to a 404. Two things are therefore pinned here:
 *
 *  - every entry points at a page that exists;
 *  - every admin page is reached by exactly one entry, so no page lights
 *    up two items in the sidebar (which is what a missing `exact` on a
 *    parent page used to do — /admin/email lit up both 邮件 and 营销邮件).
 *
 * The second assertion is checked against the pages on disk, not against
 * a hand-written list, so a new page that nobody linked to fails here.
 */

const ADMIN_DIR = join(process.cwd(), 'app', 'admin');

/** Every admin route, with the dynamic segments filled in. */
function adminRoutes(): string[] {
  const routes: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) {
        if (entry === 'page.tsx') routes.push(prefix);
        continue;
      }
      const segment = entry.startsWith('[')
        ? 'sample'
        : entry.startsWith('(')
          ? ''
          : entry;
      const next = segment ? `${prefix}/${segment}` : prefix;
      walk(full, next);
    }
  };

  walk(ADMIN_DIR, '/admin');
  return routes;
}

/** The items of the navigation, flattened. */
function items(): NavItem[] {
  return ADMIN_NAV_GROUPS.flatMap((group) => group.items);
}

/** The items that light up on a path. */
function activeOn(path: string): NavItem[] {
  return items().filter((item) =>
    item.exact ? path === item.href : path.startsWith(item.href),
  );
}

describe('the admin navigation', () => {
  it('points every entry at a page that exists', () => {
    for (const item of items()) {
      const relative = item.href.replace(/^\/admin/, '').replace(/^\//, '');
      const page = relative
        ? join(ADMIN_DIR, relative, 'page.tsx')
        : join(ADMIN_DIR, 'page.tsx');
      expect(existsSync(page), `${item.href} has no page (${page})`).toBe(true);
    }
  });

  it('never links the same page twice', () => {
    const hrefs = items().map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('gives every entry an icon and a label', () => {
    for (const item of items()) {
      expect(item.label.length, `${item.href} has no label`).toBeGreaterThan(0);
      expect(item.icon, `${item.href} has no icon`).toBeTruthy();
    }
  });

  it('lights up exactly one entry on every admin page', () => {
    for (const route of adminRoutes()) {
      const active = activeOn(route);
      expect(active.map((i) => i.href), `${route} lights up ${active.length} entries`).toHaveLength(
        1,
      );
    }
  });

  it('has an MCP entry, next to the other user pages', () => {
    const group = ADMIN_NAV_GROUPS.find((g) => g.items.some((i) => i.href === '/admin/mcp'));
    expect(group, 'the MCP entry has no group').toBeTruthy();
    expect(group?.label).toBe('用户');
    const mcp = group?.items.find((i) => i.href === '/admin/mcp');
    expect(mcp?.label).toBe('MCP 管理');
  });

  it('keeps the email entry from lighting up the campaigns page', () => {
    const mail = items().find((i) => i.href === '/admin/email');
    expect(mail?.exact).toBe(true);
    expect(activeOn('/admin/email/campaigns').map((i) => i.href)).toEqual(['/admin/email/campaigns']);
  });

  it('keeps the dashboard from lighting up every other page', () => {
    const dashboard = items().find((i) => i.href === '/admin');
    expect(dashboard?.exact).toBe(true);
  });
});
