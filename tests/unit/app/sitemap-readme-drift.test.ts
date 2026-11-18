/**
 * The sitemap must advertise every sitemap the site serves, and the
 * README must not lie about the test infrastructure.
 *
 * Two separate drifts, found in the same scan:
 *
 * 1. `/sitemap/etymology.xml` exists as a route and returns ~8000 URLs,
 *    but nothing points at it: `app/sitemap.ts` lists poetry.xml,
 *    ancient.xml and chars.xml, and NOT etymology.xml. `app/robots.ts`
 *    points at `/sitemap.xml` alone. A crawler that reads the sitemap
 *    index never learns the etymology URLs exist.
 *
 * 2. `/rare-chars` and `/stories` are public pages with their own content
 *    and are in no sitemap at all.
 *
 * 3. The README says:
 *      "⚠️ 本项目已移除测试基础设施 (vitest + 175 个测试文件)。所有测试由人工浏览器烟测替代。"
 *    That was true once. It is not true now: the repo has a vitest
 *    suite with 246 test files, `npm test` runs it, and the CI-style
 *    commands below it are commented out as "历史命令 (不再可用)" — which
 *    is exactly the instruction a newcomer would follow, and it sends
 *    them to a command that no longer exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

const SITEMAP = 'app/sitemap.ts';
const ROBOTS = 'app/robots.ts';

describe('the sitemap index', () => {
  it('links every sitemap the site serves', () => {
    const source = readSource(SITEMAP);
    // Each of these is a route under app/sitemap/. If one is missing from
    // the index, a crawler never learns those URLs exist.
    for (const sitemap of [
      'poetry.xml',
      'ancient.xml',
      'chars.xml',
      'etymology.xml',
    ]) {
      expect(
        source,
        `the sitemap index must link ${sitemap} — it is a route that is otherwise orphaned`,
      ).toContain(sitemap);
    }
  });

  it('lists the public pages that are in no other sitemap', () => {
    const source = readSource(SITEMAP);
    for (const page of ['/rare-chars', '/stories']) {
      expect(
        source,
        `the sitemap index must list ${page}`,
      ).toContain(page);
    }
  });
});

describe('the robots file', () => {
  it('points at the sitemap index', () => {
    const source = readSource(ROBOTS);
    expect(source, 'robots.txt must point at the sitemap').toContain('/sitemap.xml');
  });
});

describe('the README', () => {
  const readme = readSource('README.md');

  it('does not claim the test infrastructure was removed', () => {
    expect(
      readme,
      'the README says the test infrastructure was removed — it was restored and is in use',
    ).not.toContain('已移除测试基础设施');
  });

  it('documents the command that actually runs the tests', () => {
    // The repo uses npm (package-lock.json), not pnpm.
    expect(readme, 'the README must document `npm test`').toContain('npm test');
  });

  it('does not tell the reader the test command is unavailable', () => {
    expect(
      readme,
      'the README still calls the test command "历史命令 (不再可用)"',
    ).not.toContain('不再可用');
  });
});
