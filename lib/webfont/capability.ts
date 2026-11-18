/**
 * The capability probe of the admin font pipeline (design §3.4).
 *
 * Before an administrator is allowed to start a font build, this module
 * answers one question: **does this machine have everything the pipeline
 * needs?** The pipeline is four steps — download the source fonts, clip
 * the variable axes, subset the families, verify the result — and each
 * step needs something different:
 *
 *   | capability | how it is probed                                  |
 *   |------------|---------------------------------------------------|
 *   | Node       | `process.version` — it is running, so it is there  |
 *   | Python     | `python --version` (the `PYTHON` override honoured) |
 *   | fontTools  | `python -I -m fontTools.varLib.instancer --help`   |
 *   | upstream   | one `HEAD` on the first source url — never a GET   |
 *   | disk       | a probe file in the STAGING dir + a permission check |
 *   | toolchain  | `subset-font`, `typescript`, `tsx`                  |
 *
 * Four properties this module keeps, in this order:
 *
 *  1. **The probe reports, it never crashes.** Every probe is an
 *     interaction with the outside world — a subprocess, a file write, an
 *     HTTP HEAD — and every one of them can fail in a way that throws.
 *     A probe that threw instead of reporting would show the
 *     administrator an error page instead of the list of what is
 *     missing and how to fix it. So every external interaction is
 *     wrapped, and a failure becomes a line in the report.
 *  2. **A missing capability is never a green light.** `ok` is false
 *     when *any* of the six rows above is missing — including one of the
 *     three toolchain packages. The admin page keeps the "开始构建"
 *     button disabled while it is false.
 *  3. **The probe measures the thing the pipeline writes.** The disk row
 *     looks at BOTH directories the pipeline writes into, with the
 *     method each one allows: a probe file in the staging directory
 *     (deleted again), and a WRITABILITY CHECK on the font root. The
 *     font root is never written to — it is the production directory,
 *     Next serves it, and a probe file that could not be deleted would
 *     go live with the release. It is checked anyway, because it is
 *     often a MOUNT: a staging volume that takes the 70 MB says
 *     nothing about a font-root volume that is full or read-only.
 *  4. **Nothing is written into the production tree.** Not into
 *     `public/font/`, not anywhere under `public/`. The upstream probe
 *     is a single HEAD, and the download belongs to step ①, not here.
 *
 * The upstream url is NOT hardcoded: it is read from `SOURCES`, the same
 * list the downloader uses, so the probe and the pipeline can never
 * disagree about which server the fonts come from.
 *
 * ## THE SPLIT
 *
 * This module is the ORCHESTRATION: it decides what is probed, in what
 * order, and what the report says. The two kinds of work it used to
 * hold now live elsewhere:
 *
 *   - `module-resolution.ts` — reading the disk to find a package's
 *     entry point (no side effects);
 *   - `probes.ts` — the side effects themselves (a subprocess, a file
 *     write, an HTTP HEAD);
 *   - `types.ts` — the shapes both of them speak.
 *
 * Every export of the original module is still exported from here, so
 * `import { probeCapability } from '@/lib/webfont/capability'` keeps
 * working unchanged.
 */
import 'server-only';

import { join } from 'node:path';

import { appRoot, resolveFontDir } from './module-resolution';
import {
  checkFontDir,
  defaultResolveModule,
  defaultRunCommand,
  hostOf,
  probeFontTools,
  probeNetwork,
  probePython,
  probeSources,
  probeStagingDir,
  probeToolchain,
} from './probes';
import type { CapabilityReport, ProbeOptions } from './types';

export type {
  CapabilityReport,
  CommandResult,
  ProbeOptions,
  RunCommand,
} from './types';

/**
 * The module resolution is re-exported from here, because the admin
 * route imports it from `@/lib/webfont/capability` — and the resolution
 * IS part of what the capability probe answers.
 */
export {
  resolveArgv,
  resolveFontDir,
  resolveModuleEntry,
} from './module-resolution';

/**
 * The remedy for a machine without the three build packages (design
 * §3.4.1).
 *
 * The text is user facing, so it carries no markdown: no `**` and no
 * backticks. The command itself is literal — a test asserts it.
 */
const TOOLCHAIN_REMEDY =
  '字体构建工具链没装齐：subset-font / typescript / tsx 是生产依赖，' +
  '服务器用 npm install --omit=dev 装 ⇒ 缺它们不是这台机器坏了，' +
  '是依赖没提到 dependencies 里。修复：' +
  'npm install subset-font@^2.4.0 typescript@^5.6.3 tsx@^4.19.2 --save 然后重装。';

/** The remedy for a machine without fontTools (design §3.4). */
const FONTTOOLS_REMEDY =
  'Python 在，但 fontTools 没装：pip install fonttools（或 python -m pip install fonttools）。';

/**
 * The remedy for fontTools on a machine without python.
 *
 * The sentence above would be a lie there ("python IS there"), so this
 * one says what to do once python is installed — the same command the
 * axis instancer itself prints (`instance-webfont-axis.mjs:389`).
 */
const FONTTOOLS_REMEDY_WITHOUT_PYTHON =
  'Python 还没装，fontTools 自然也装不上；装好 Python 之后执行 python -m pip install fonttools brotli';

/** The remedy for a machine without a python interpreter (design §3.4). */
const PYTHON_MISSING_REMEDY = '找不到 Python 解释器。装一个，或者设 PYTHON 环境变量指向它。';

/**
 * Probes the machine and reports what it found.
 *
 * The result is the whole answer: the caller shows it as it is. `ok` is
 * the CAPABILITY verdict — false means "this machine cannot build fonts
 * yet", which is not an error and not a failed request.
 */
export async function probeCapability(opts: ProbeOptions = {}): Promise<CapabilityReport> {
  const root = appRoot();
  const stagingDir = opts.stagingDir ?? join(root, 'scripts', 'fonts', 'staging', 'web');
  const fontDir = opts.fontDir ?? resolveFontDir(root);
  const run = opts.runCommand ?? defaultRunCommand;
  const fetchImpl = opts.fetchImpl ?? fetch;
  // The default resolver reads the disk (see `resolveModuleEntry`) —
  // the application root is the one every other path is derived from.
  const resolveModule = opts.resolveModule ?? defaultResolveModule(root);

  const [python, fonttools, network, toolchain] = await Promise.all([
    probePython(run),
    probeFontTools(run),
    probeNetwork(fetchImpl),
    probeToolchain(run, resolveModule),
  ]);

  // The disk row is two probes: the staging directory is written into
  // (and the probe file deleted again), the font root is only checked
  // for writability — it is the production directory, and nothing is
  // ever written there.
  const staging = probeStagingDir(stagingDir);
  const fontRoot = checkFontDir(fontDir);
  const disk = {
    available: staging.ok && fontRoot.ok,
    stagingDir,
    fontDir,
    error:
      [
        staging.ok ? null : `staging 目录 ${stagingDir}：${staging.error}`,
        fontRoot.ok ? null : `字体根目录 ${fontDir}：${fontRoot.error}`,
      ]
        .filter((reason): reason is string => reason !== null)
        .join('；') || null,
  };
  const sources = probeSources(stagingDir);

  // The fontTools remedy says "Python 在，但 fontTools 没装" — that would be
  // a lie on a machine without python at all, so there the remedy says
  // what to do once python is installed. Either way the row is reported:
  // fontTools really is missing when the row says so.
  const fontToolsRemedy = python.available ? FONTTOOLS_REMEDY : FONTTOOLS_REMEDY_WITHOUT_PYTHON;

  const missing: string[] = [];
  if (!python.available) {
    missing.push(
      python.notInstalled
        ? PYTHON_MISSING_REMEDY
        : `Python 解释器存在但跑不起来（${python.error}）。检查这个解释器是否装坏了，` +
          '或设 PYTHON 环境变量指向一个可用的解释器。',
    );
  }
  if (!fonttools.available) {
    missing.push(fontToolsRemedy);
  }
  if (!network.available) {
    if (network.checkedUrl === '') {
      missing.push('没有配置字体源 URL，无法探测上游可达性。');
    } else {
      const host = hostOf(network.checkedUrl);
      missing.push(
        `连不上 ${host}（DNS/TLS/超时）。这台机器可能没有出网权限，请检查网络、代理或 DNS 后重试。`,
      );
    }
  }
  if (!staging.ok) {
    missing.push(
      `staging 目录不可写：${stagingDir}（${staging.error ?? '未知原因'}）。` +
        '流水线要把下载的源字体写进这个目录，请检查该目录的写权限和磁盘空间。',
    );
  }
  if (!fontRoot.ok) {
    missing.push(
      `字体根目录不可写：${fontDir}（${fontRoot.error ?? '未知原因'}）。` +
        '流水线要把发布产物写进这个目录，请检查该目录的写权限和磁盘空间。',
    );
  }
  // Three of three or nothing: the build steps ③ and ④ need all three
  // packages, so one missing package makes the whole toolchain unusable.
  // The remedy names the whole toolchain and the one command that
  // installs it — including the packages that are already there, because
  // the command installs all three at once. The `toolchain` field says
  // which one is actually missing.
  if (!toolchain.subsetFont || !toolchain.typescript || !toolchain.tsx) {
    missing.push(TOOLCHAIN_REMEDY);
  }

  const ok =
    python.available &&
    fonttools.available &&
    network.available &&
    disk.available &&
    toolchain.subsetFont &&
    toolchain.typescript &&
    toolchain.tsx;

  return {
    ok,
    node: process.version,
    python: {
      available: python.available,
      version: python.version,
      error: python.error,
    },
    fonttools: {
      available: fonttools.available,
      version: fonttools.version,
      error: fonttools.error,
      remedy: fonttools.available ? null : fontToolsRemedy,
    },
    network: {
      available: network.available,
      checkedUrl: network.checkedUrl,
      error: network.error,
    },
    disk: {
      available: disk.available,
      stagingDir: disk.stagingDir,
      fontDir: disk.fontDir,
      error: disk.error,
    },
    toolchain,
    sources,
    missing,
  };
}
