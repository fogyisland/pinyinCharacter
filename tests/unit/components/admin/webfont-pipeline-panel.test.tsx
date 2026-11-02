// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

global.fetch = vi.fn();

import WebfontPipelinePanel from '@/components/admin/WebfontPipelinePanel';
import type { WebfontJob } from '@/lib/webfont/jobs';

/**
 * The admin font pipeline panel.
 *
 * Every assertion here pins a decision the panel made, and most of them pin
 * a decision that could have been made the wrong way:
 *
 *  - the capability probe answers `200` with `ok: false` when the machine is
 *    missing something ⇒ the panel must render the report ANYWAY, because the
 *    remedy is the whole point of the panel;
 *  - the two tokens (T and V) differ on purpose ⇒ the panel must show both
 *    and must never call the difference an error;
 *  - the page-cost budget describes the LIVE release ⇒ the panel shows the
 *    new numbers beside the old ones and says which lines a human has to
 *    change — and it has NO button that writes them;
 *  - a release that was already gone from the disk was NOT deleted by the
 *    cleanup ⇒ the panel must say so in different words.
 *
 * ⚠️ The timers are FAKE in every test: the poll chain waits 1500 ms, and a
 * real wait would make the suite slow and flaky. `afterEach` puts the real
 * timers back.
 */

/** A job as the API returns it. */
function job(overrides: Partial<WebfontJob> = {}): WebfontJob {
  return {
    id: 'job0000000000001',
    status: 'done',
    step: 'verify',
    stepProgress: '',
    message: '构建完成',
    error: null,
    log: '2026-11-01 12:00:00 构建开始\n',
    manifestVersion: 'abc123def456',
    releaseDir: '',
    startedBy: 1,
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:05:00.000Z',
    finishedAt: '2026-11-01T12:05:00.000Z',
    ...overrides,
  };
}

/**
 * The capability report — the REAL body of
 * `GET /api/admin/webfonts/capability` (flat, no envelope).
 */
const CAPABILITY_OK = {
  ok: true,
  node: 'v22.14.0',
  python: { available: true, version: '3.12.7', error: null },
  fonttools: { available: true, version: '4.55.0', error: null, remedy: null },
  network: { available: true, checkedUrl: 'https://example.test/font.woff2', error: null },
  disk: {
    available: true,
    stagingDir: 'E:\\app\\scripts\\fonts\\staging\\web',
    fontDir: 'E:\\app\\public\\font',
    error: null,
  },
  toolchain: { subsetFont: true, typescript: true, tsx: true },
  sources: [{ filename: 'SourceHanSansVF.ttf', label: '思源黑体', present: true, size: 12345 }],
  missing: [],
};

/** The capability report of a machine that is missing the build toolchain. */
const CAPABILITY_MISSING = {
  ...CAPABILITY_OK,
  ok: false,
  toolchain: { subsetFont: false, typescript: false, tsx: false },
  missing: [
    '字体构建工具链没装齐：subset-font / typescript / tsx 是生产依赖，' +
      '服务器用 npm install --omit=dev 装 ⇒ 缺它们不是这台机器坏了，' +
      '是依赖没提到 dependencies 里。修复：' +
      'npm install subset-font@^2.4.0 typescript@^5.6.3 tsx@^4.19.2 --save 然后重装。',
  ],
};

/** The release ledger — the REAL body of `GET /api/admin/webfonts/releases`. */
const RELEASES = {
  ok: true,
  releases: [
    {
      dir: 'r0a1b2c3d4e5f',
      token: '0a1b2c3d4e5f',
      publishedAt: '2026-10-01T00:00:00.000Z',
      supersededAt: '2026-10-20T00:00:00.000Z',
      deletedAt: null,
      files: 7981,
      bytes: 28236168,
      canClean: true,
    },
    {
      dir: 'r9988776655443',
      token: '9988776655443',
      publishedAt: '2026-11-01T00:00:00.000Z',
      supersededAt: null,
      deletedAt: null,
      files: 7990,
      bytes: 28300000,
      canClean: false,
    },
  ],
  bytes: 56536168,
  keep: '保留最近 3 份，且被取代超过 30 天的 release 不删除',
};

/** The apply response — the REAL body of `POST /api/admin/webfonts/build/[id]/apply`. */
const APPLY_OK = {
  ok: true,
  job: job({ step: 'apply', message: '已应用', releaseDir: 'r0a1b2c3d4e5f' }),
  manifestVersion: 'fedcba987654',
  releaseToken: '0a1b2c3d4e5f',
  releaseDir: 'r0a1b2c3d4e5f',
  summary: {
    liveFiles: 7981,
    liveBytes: 28236168,
    newFiles: 7990,
    newBytes: 28300000,
    releaseBytes: 28300000,
  },
  pageCost: {
    bytes: { '/': 560610, '/dictionary': 412672, '/poetry': 301056, '/stories': 925696 },
    files: { '/': 153, '/dictionary': 120, '/poetry': 98, '/stories': 153 },
    budgetBytes: { '/': 839680, '/dictionary': 330752, '/poetry': 241664, '/stories': 1214464 },
    budgetFiles: 255,
  },
  reimport: {
    required: true,
    command: 'node scripts/fonts/import-webfont-release.mjs --release r0a1b2c3d4e5f',
    note: '产物已发布到服务器，但尚未回灌仓库；在回灌之前不要部署 —— 否则会把旧样式表覆盖回去。',
  },
  rebaseline: [
    {
      file: 'tests/unit/lib/fonts-css.test.ts',
      line: 310,
      what: 'subsets.length',
      current: 7981,
      expected: 7990,
      always: true,
    },
    {
      file: 'tests/unit/lib/fonts-css.test.ts',
      line: 311,
      what: '总字节',
      current: 28236168,
      expected: 28300000,
      always: true,
    },
    {
      file: 'tests/unit/lib/fonts-css.test.ts',
      line: 298,
      what: 'cssBytes（原始）',
      current: 2023175,
      expected: 2030000,
      always: true,
    },
    {
      file: 'tests/unit/lib/fonts-css.test.ts',
      line: 73,
      what: 'gzipBytes（sans / serif / wenkai）',
      current: [55821, 64536, 38491],
      expected: [56000, 64700, 38600],
      always: true,
    },
    {
      file: 'scripts/fonts/verify-webfont-subsets.mjs',
      line: 201,
      what: 'LIMITS.unionSampleBytes',
      current: [839680, 330752, 241664, 1214464],
      expected: null,
      always: false,
      note: 'Task 2 已把这一行改成 face.release 动态跟随，不需要人工改',
    },
    {
      file: 'scripts/fonts/verify-webfont-subsets.mjs',
      line: 207,
      what: 'LIMITS.maxUnionSampleFilesPerPage',
      current: 255,
      expected: null,
      always: false,
      note: '量不出页成本（并集样本读不到），未判定',
    },
    {
      file: 'tests/unit/deploy/nginx-config.test.ts',
      line: 688,
      what: '读盘路径',
      current: 'public/font/web/<release>/<dir>/<file>',
      expected: null,
      always: false,
      note: 'Task 2 已把这一行改成 face.release 动态跟随，不需要人工改',
    },
  ],
};

/** A `Response`-alike whose `json()` answers the given body. */
function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

/**
 * Installs a fetch mock that answers by URL.
 *
 * @param routes the answers, keyed by the path (a substring match)
 */
function mockFetch(routes: Array<[string, () => Response]>): void {
  vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [needle, answer] of routes) {
      if (url.includes(needle)) return answer();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** The routes the panel talks to, with their default answers. */
function defaultRoutes(): Array<[string, () => Response]> {
  return [
    ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
    ['/api/admin/webfonts/releases/cleanup', () => response({ ok: true, removed: [], kept: [] })],
    ['/api/admin/webfonts/releases', () => response(RELEASES)],
    ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
  ];
}

/**
 * Lets every pending microtask and every pending timer callback run.
 *
 * ⚠️ Under fake timers a `findByText` never resolves on its own: the
 * `waitFor` loop sleeps on a timer that never fires. ⇒ The tests advance the
 * clock explicitly and read the screen synchronously.
 */
async function flush(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Advances the fake clock and lets the answers land. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await flush();
}

describe('WebfontPipelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockFetch(defaultRoutes());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ── 1. the capability report: ok:false still renders the remedy ────────
  it('renders what the machine is missing and disables the build button when ok is false', async () => {
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_MISSING)],
      ...defaultRoutes().slice(1),
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    // The remedy text reaches the operator — this is the whole point of
    // rendering a report whose verdict is "not ok".
    expect(screen.getByText(/字体构建工具链没装齐/)).toBeInTheDocument();

    const start = screen.getByRole('button', { name: /开始构建/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  // ── R-88: the repair command names `--save` ─────────────────────────────
  it('shows the toolchain repair command with --save and never a bare npm install', async () => {
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_MISSING)],
      ...defaultRoutes().slice(1),
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    const remedy = screen.getByText(/字体构建工具链没装齐/);
    const text = remedy.textContent ?? '';
    expect(text).toContain('--save');
    // The bare `npm install` and the `--omit=dev` variant are both wrong:
    // the first pulls the whole dev tree, the second installs nothing.
    expect(text).not.toMatch(/npm install(?![^\n]*--save)/);
  });

  // ── 2. the capability report: ok:true enables the button ───────────────
  it('enables the build button when the capability report is ok', async () => {
    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    const start = screen.getByRole('button', { name: /开始构建/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
  });

  // ── R-87: the disk row shows BOTH paths ────────────────────────────────
  it('shows both disk paths of the capability report', async () => {
    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    const diskRow = screen.getByRole('row', { name: /磁盘可写/ });
    const text = diskRow.textContent ?? '';
    expect(text).toContain('staging');
    expect(text).toContain('public');
  });

  // ── 3. the polling stops at a terminal status and shows the failure ────
  it('polls every 1500 ms and shows the failure reason when the job fails', async () => {
    const failed = job({ status: 'failed', message: '构建失败', error: '找不到 Python 解释器' });
    let polls = 0;
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      ['/api/admin/webfonts/releases', () => response(RELEASES)],
      [
        '/api/admin/webfonts/build/job0000000000001',
        () => {
          polls += 1;
          return response({ ok: true, job: failed });
        },
      ],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /开始构建/ }));
    await flush();

    // The first poll happens 1500 ms after the build starts — not before.
    expect(polls).toBe(0);
    await advance(1500);
    expect(polls).toBe(1);

    // The failure reason is shown to the operator.
    expect(screen.getByText(/找不到 Python 解释器/)).toBeInTheDocument();

    // The chain stops: a terminal status schedules no further poll.
    await advance(5000);
    expect(polls).toBe(1);
  });

  // ── R-81: the chain is a setTimeout chain and unmount clears it ────────
  it('stops polling when the panel unmounts', async () => {
    let polls = 0;
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      ['/api/admin/webfonts/releases', () => response(RELEASES)],
      [
        '/api/admin/webfonts/build/job0000000000001',
        () => {
          polls += 1;
          return response({ ok: true, job: job({ status: 'running' }) });
        },
      ],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    const view = render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /开始构建/ }));
    await flush();

    await advance(1500);
    expect(polls).toBe(1);

    view.unmount();
    await advance(15000);
    expect(polls).toBe(1);
  });

  /**
   * Starts a build, polls it once and applies it.
   *
   * The four steps are the ones every apply test needs, and they are the
   * steps the panel really walks: POST build ⇒ one poll ⇒ POST apply.
   */
  async function runBuildAndApply(): Promise<void> {
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      ['/api/admin/webfonts/releases', () => response(RELEASES)],
      ['/api/admin/webfonts/build/job0000000000001/apply', () => response(APPLY_OK)],
      [
        '/api/admin/webfonts/build/job0000000000001',
        () => response({ ok: true, job: job({ status: 'done' }) }),
      ],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /开始构建/ }));
    await flush();
    await advance(1500);

    const apply = screen.getByRole('button', { name: /^应用$/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    await flush();
  }

  // ── 4. the apply panel shows the versions, the diff and the warning ────
  it('shows the new and old versions, the file/byte difference and the no-commit warning', async () => {
    await runBuildAndApply();

    // The two tokens, each labelled.
    expect(screen.getByText('fedcba987654')).toBeInTheDocument();
    expect(screen.getByText('0a1b2c3d4e5f')).toBeInTheDocument();
    expect(screen.getByText(/发布令牌/)).toBeInTheDocument();
    expect(screen.getByText(/清单版本/)).toBeInTheDocument();

    // The difference summary: the live numbers next to the new ones.
    const diff = screen.getByRole('table', { name: /产物差异/ });
    expect(diff.textContent).toContain('7 981');
    expect(diff.textContent).toContain('7 990');

    // The warning from spec §7 — visible, not a tooltip.
    expect(
      screen.getByText((_content, element) =>
        (element?.textContent ?? '').includes('自动 commit'),
        { selector: 'p' },
      ),
    ).toBeInTheDocument();
  });

  // ── 5. the two tokens differ — and that is normal ─────────────────────
  it('shows both tokens without complaining when they differ', async () => {
    await runBuildAndApply();

    expect(screen.getByText('fedcba987654')).toBeInTheDocument();
    expect(screen.getByText('0a1b2c3d4e5f')).toBeInTheDocument();
    // The difference is stated as normal, not as an error.
    expect(screen.getByText(/T ≠ V 是正常的/)).toBeInTheDocument();
  });

  // ── 6. the page cost: the new numbers beside the old ones ─────────────
  it('shows the new and old page cost side by side and names the lines to change', async () => {
    await runBuildAndApply();

    // The measured bytes and the budget bytes are both on the screen.
    expect(screen.getByText('560 610')).toBeInTheDocument();
    expect(screen.getByText('839 680')).toBeInTheDocument();

    // The explanation says what the budget describes and where to change it.
    // ⚠️ The sentence is broken up by inline elements ⇒ the matcher looks at
    // the text of the paragraph that carries it. The paragraph is found by
    // the one phrase that only IT carries.
    const costBlock = screen
      .getByText(/漂移探测器在正常工作/)
      .closest('p');
    expect(costBlock?.textContent).toContain('描述的是');
    expect(costBlock?.textContent).toContain('线上那一份');
    expect(costBlock?.textContent).toContain('LIMITS.unionSampleBytes');
    expect(costBlock?.textContent).toContain('LIMITS.maxUnionSampleFilesPerPage');

    // ⚠️ There is NO button that writes the budget into the repository.
    expect(screen.queryByRole('button', { name: /一键/ })).toBeNull();
  });

  // ── R-79: the page cost has not reached the HTML yet ───────────────────
  it('says the stylesheet token only changes at the next build', async () => {
    await runBuildAndApply();

    expect(screen.getByText(/令牌.*下一次构建/)).toBeInTheDocument();
  });

  // ── 7. the 「待回灌」 block ─────────────────────────────────────────────
  it('renders the pending re-import block with the copyable command', async () => {
    await runBuildAndApply();

    // The title, the consequence and the hard sentence.
    expect(screen.getByText(/产物已发布，但尚未回灌仓库/)).toBeInTheDocument();
    expect(screen.getByText(/静默回滚/)).toBeInTheDocument();
    expect(screen.getByText(/回灌之前不要部署/)).toBeInTheDocument();

    // The command itself, copyable.
    expect(
      screen.getByText('node scripts/fonts/import-webfont-release.mjs --release r0a1b2c3d4e5f'),
    ).toBeInTheDocument();
  });

  // ── 8. the seven re-base entries ───────────────────────────────────────
  it('renders the seven re-base rows and marks the unchanged ones', async () => {
    await runBuildAndApply();

    const table = screen.getByRole('table', { name: /要重标定/ });
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(7);

    // The columns: 文件:行 / 钉的是什么 / 现在钉的是几 / 新的该是多少.
    expect(table.textContent).toContain('tests/unit/lib/fonts-css.test.ts:310');
    expect(table.textContent).toContain('subsets.length');
    expect(table.textContent).toContain('LIMITS.unionSampleBytes');

    // ⚠️ The 「未判定」 entry must NOT say 「不用改」.
    const unjudgedRow = Array.from(rows).find((row) =>
      (row.textContent ?? '').includes('maxUnionSampleFilesPerPage'),
    );
    expect(unjudgedRow?.textContent).toContain('未判定');
    expect(unjudgedRow?.textContent).not.toContain('不用改');

    // ⚠️ And there is no 「一键修改」 button anywhere.
    expect(screen.queryByRole('button', { name: /一键/ })).toBeNull();
  });

  // ── 9. the release ledger: the superseded time ─────────────────────────
  it('shows the superseded time and a dash for the release that is still current', async () => {
    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    expect(screen.getByText('2026-10-20T00:00:00.000Z')).toBeInTheDocument();
    // The current release has no superseded time ⇒ a dash.
    const table = screen.getByRole('table', { name: /release/ });
    const rows = table.querySelectorAll('tbody tr');
    const currentRow = Array.from(rows).find((row) =>
      (row.textContent ?? '').includes('r9988776655443'),
    );
    expect(currentRow?.textContent).toContain('—');
  });

  // ── R-77: `canClean` comes from the backend; a missing one is a dash ───
  it('renders a dash when a release carries no canClean verdict', async () => {
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      [
        '/api/admin/webfonts/releases',
        () =>
          response({
            ...RELEASES,
            releases: [
              {
                dir: 'r0a1b2c3d4e5f',
                token: '0a1b2c3d4e5f',
                publishedAt: '2026-10-01T00:00:00.000Z',
                supersededAt: '2026-10-20T00:00:00.000Z',
                deletedAt: null,
                files: 7981,
                bytes: 28236168,
              },
            ],
          }),
      ],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    const table = screen.getByRole('table', { name: /release/ });
    const row = table.querySelector('tbody tr');
    expect(row?.textContent).toContain('—');
    expect(row?.textContent).not.toContain('否');
  });

  // ── R-189 / R-203: the two cleanup outcomes use different words ───────
  it('tells a deleted directory apart from one that was never on the disk', async () => {
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      [
        '/api/admin/webfonts/releases/cleanup',
        () =>
          response({
            ok: true,
            removed: [
              { dir: 'raaaa', bytes: 1000, removed: true },
              { dir: 'rbbbb', bytes: 0, removed: false },
            ],
            kept: ['rcccc'],
            repoHint: '仓库里那 1 份也要 git rm -r（raaaa）',
          }),
      ],
      ['/api/admin/webfonts/releases', () => response(RELEASES)],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /清理 release/ }));
    await flush();

    expect(screen.getByText(/已删除/)).toBeInTheDocument();
    // ⚠️ The directory that was never there was NOT deleted.
    expect(screen.getByText(/本来就不在盘上/)).toBeInTheDocument();
    expect(screen.getByText(/未删除/)).toBeInTheDocument();
  });

  // ── R-203: `repoHint` is optional ──────────────────────────────────────
  it('renders the cleanup result even when the response carries no repoHint', async () => {
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      [
        '/api/admin/webfonts/releases/cleanup',
        () =>
          response({
            ok: true,
            removed: [{ dir: 'raaaa', bytes: 0, removed: false }],
            kept: [],
          }),
      ],
      ['/api/admin/webfonts/releases', () => response(RELEASES)],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /清理 release/ }));
    await flush();

    expect(screen.getByText(/本来就不在盘上/)).toBeInTheDocument();
  });

  // ── the 409 of the cleanup ─────────────────────────────────────────────
  it('shows the refusal when there is nothing to clean', async () => {
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      [
        '/api/admin/webfonts/releases/cleanup',
        () =>
          response(
            { ok: false, error: { code: 'nothing_to_clean', message: '没有可清理的 release' } },
            false,
            409,
          ),
      ],
      ['/api/admin/webfonts/releases', () => response(RELEASES)],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /清理 release/ }));
    await flush();

    expect(screen.getByText(/没有可清理的 release/)).toBeInTheDocument();
  });

  // ── R-131: the log is a transcript ─────────────────────────────────────
  it('renders the job log verbatim as preformatted text', async () => {
    const transcript = '2026-11-01 12:00:00 下载源字体\n2026-11-01 12:00:05 切分 sans 族\n';
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      ['/api/admin/webfonts/releases', () => response(RELEASES)],
      [
        '/api/admin/webfonts/build/job0000000000001',
        () => response({ ok: true, job: job({ status: 'running', log: transcript }) }),
      ],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /开始构建/ }));
    await flush();
    await advance(1500);

    const log = screen.getByText(/下载源字体/);
    expect(log.tagName).toBe('PRE');
    // The line is rendered as it is — the timestamp is not parsed away.
    expect(log.textContent).toContain('2026-11-01 12:00:00 下载源字体');
  });

  // ── the incremental log: a line is never rendered twice ───────────────
  it('renders every line of a growing transcript exactly once', async () => {
    let polls = 0;
    const transcripts = [
      '2026-11-01 12:00:00 第一行\n',
      '2026-11-01 12:00:00 第一行\n2026-11-01 12:00:05 第二行\n',
    ];
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      ['/api/admin/webfonts/releases', () => response(RELEASES)],
      [
        '/api/admin/webfonts/build/job0000000000001',
        () => {
          const transcript = transcripts[Math.min(polls, transcripts.length - 1)];
          polls += 1;
          return response({ ok: true, job: job({ status: 'running', log: transcript }) });
        },
      ],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /开始构建/ }));
    await flush();

    // Two polls: the transcript grows between them.
    await advance(1500);
    await advance(1500);

    const log = screen.getByText(/第一行/);
    expect(log.tagName).toBe('PRE');
    const text = log.textContent ?? '';
    expect(text).toContain('第二行');
    // ⚠️ The transcript is read FROM THE TOP on every poll ⇒ a stale
    // counter would put 「第一行」 on the screen a second time.
    expect(text.split('第一行').length - 1).toBe(1);
    expect(text.split('第二行').length - 1).toBe(1);
  });

  // ── the cancel ─────────────────────────────────────────────────────────
  it('cancels a running job and says that the running step finishes on its own', async () => {
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      ['/api/admin/webfonts/releases', () => response(RELEASES)],
      [
        '/api/admin/webfonts/build/job0000000000001/cancel',
        () => response({ ok: true, job: job({ status: 'cancelled', message: '已取消' }) }),
      ],
      [
        '/api/admin/webfonts/build/job0000000000001',
        () => response({ ok: true, job: job({ status: 'running' }) }),
      ],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /开始构建/ }));
    await flush();
    await advance(1500);

    fireEvent.click(screen.getByRole('button', { name: /^取消$/ }));
    await flush();

    expect(screen.getByText(/已取消；正在跑的那一步会自己跑完/)).toBeInTheDocument();
  });

  // ── R-86: the POSTs send no body ───────────────────────────────────────
  it('sends empty bodies on the POSTs', async () => {
    mockFetch([
      ['/api/admin/webfonts/capability', () => response(CAPABILITY_OK)],
      ['/api/admin/webfonts/releases', () => response(RELEASES)],
      [
        '/api/admin/webfonts/build/job0000000000001/cancel',
        () => response({ ok: true, job: job({ status: 'cancelled' }) }),
      ],
      [
        '/api/admin/webfonts/build/job0000000000001',
        () => response({ ok: true, job: job({ status: 'running' }) }),
      ],
      ['/api/admin/webfonts/build', () => response({ ok: true, jobId: 'job0000000000001' }, true, 202)],
    ]);

    render(<WebfontPipelinePanel initialJobs={[]} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /开始构建/ }));
    await flush();
    await advance(1500);
    fireEvent.click(screen.getByRole('button', { name: /^取消$/ }));
    await flush();

    const posts = vi
      .mocked(global.fetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(posts.length).toBeGreaterThan(0);
    for (const [, init] of posts) {
      const body = (init as RequestInit).body;
      expect(body === undefined || body === null || body === '').toBe(true);
    }
  });

  // ── R-83/R-84: the panel must not drag mysql2 into the browser bundle ──
  it('imports the job type only — the module that reaches mysql2 is never imported', async () => {
    const fs = await import('node:fs/promises');
    // ⚠️ EVERY file of the pipeline is checked: the panel is only one of
    // them, and one value import anywhere would pull mysql2 in.
    const files = [
      'components/admin/WebfontPipelinePanel.tsx',
      'components/admin/WebfontApplyBlock.tsx',
      'components/admin/WebfontCapabilityBlock.tsx',
      'components/admin/webfont-pipeline-types.ts',
    ];
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      // A VALUE import would pull mysql2 into the browser bundle.
      expect(source).not.toMatch(
        /import\s*\{[^}]*WebfontJob[^}]*\}\s*from\s*'@\/lib\/webfont\/jobs'/,
      );
      // A TYPE import is erased at build time ⇒ it is safe.
      if (source.includes('@/lib/webfont/jobs')) {
        expect(source).toContain("import type { WebfontJob } from '@/lib/webfont/jobs'");
      }
    }
  });

  // ── the panel talks to exactly the seven endpoints ─────────────────────
  it('talks to the seven pipeline endpoints and nothing else', async () => {
    await runBuildAndApply();

    const urls = vi
      .mocked(global.fetch)
      .mock.calls.map(([input]) => (typeof input === 'string' ? input : input.toString()));
    const paths = urls.map((url) => url.split('?')[0]);

    for (const path of paths) {
      expect(path).toMatch(/^\/api\/admin\/webfonts\//);
    }

    // ⚠️ The DISTINCT paths, not the calls: the ledger is read again after
    // an apply, and that is a second call to the same endpoint — not a
    // second endpoint.
    const distinct = Array.from(new Set(paths)).sort();
    expect(distinct).toEqual([
      '/api/admin/webfonts/build',
      '/api/admin/webfonts/build/job0000000000001',
      '/api/admin/webfonts/build/job0000000000001/apply',
      '/api/admin/webfonts/capability',
      '/api/admin/webfonts/releases',
    ]);
  });
});
