/**
 * scripts/fonts/capture-page-font-profiles.mjs — the regenerator of
 * data/font-page-profiles.json.
 *
 * The fixture records, for four pages, WHICH characters each of the three
 * typefaces paints. The hot tier of the webfont subsets is seeded from it
 * (scripts/fonts/webfont-charset.mjs), so it decides what a browser
 * downloads: a character the pages paint is in the hot tier, everything
 * else waits in an Ext block.
 *
 * The attribution itself lives in scripts/perf/class-attribution.mjs — the
 * SAME module the per page font load measurement of Task 9 uses. Two
 * copies of that rule would drift, and then the fixture and the budget
 * would be talking about different characters.
 *
 * ⚠️ The capture never overwrites the committed fixture on its own: it
 * writes where `--out` says, and it prints the difference against the
 * committed fixture first. Whether the fixture is updated is a decision
 * for the coordinator (G4), not for a script.
 *
 * ⚠️ The fixture it compares against is the committed one, unless
 * `--fixture` points somewhere else — that is what makes the "there is no
 * fixture to inherit the metadata from" path reachable in a test.
 *
 * ⚠️ The production site answers anonymous requests with the
 * "initialised" page since 2026-10-29, so a LIVE capture only sees what an
 * anonymous visitor sees. The committed fixture comes from four captures
 * made before the initialisation.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectFamilyCharsets } from '../perf/class-attribution.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/** The committed fixture. It is READ, never written, unless it is named. */
const FIXTURE_PATH = join(ROOT, 'data', 'font-page-profiles.json');

/**
 * The four pages the fixture covers.
 *
 * `file` is the name of the local capture of the page — the pages of the
 * site are not named after their path.
 */
const PAGES = [
  { path: '/', file: 'home' },
  { path: '/dictionary', file: 'dictionary' },
  { path: '/poetry', file: 'poetry' },
  { path: '/stories', file: 'stories' },
];

/** The three typefaces, in the order of the fixture. */
const FAMILIES = ['sans', 'serif', 'wenkai'];

/** The default origin the live capture reads from. */
const DEFAULT_BASE = 'https://ziyun.pudafo.com';

/** How long one page may take. */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Parse the command line.
 */
function parseArgs(argv) {
  const options = {
    base: DEFAULT_BASE,
    htmlDir: null,
    out: null,
    capturedAt: null,
    source: null,
    fixture: FIXTURE_PATH,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '--base':
        options.base = argv[++index];
        break;
      case '--html-dir':
        options.htmlDir = argv[++index];
        break;
      case '--out':
        options.out = argv[++index];
        break;
      case '--captured-at':
        options.capturedAt = argv[++index];
        break;
      case '--source':
        options.source = argv[++index];
        break;
      case '--fixture':
        options.fixture = argv[++index];
        break;
      case '--force':
        options.force = true;
        break;
      default:
        throw new Error(
          `unknown argument ${JSON.stringify(argument)} — the options are ` +
            '--base, --html-dir, --out, --captured-at, --source, --fixture and --force',
        );
    }
  }
  const flags = {
    base: '--base',
    htmlDir: '--html-dir',
    out: '--out',
    capturedAt: '--captured-at',
    source: '--source',
    fixture: '--fixture',
  };
  for (const [name, flag] of Object.entries(flags)) {
    if (options[name] === undefined) {
      throw new Error(`the option ${flag} needs a value`);
    }
  }
  return options;
}

/** Today, in the local time zone: YYYY-MM-DD. */
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The characters of a set, by code point.
 *
 * The fixture stores one string per typeface, and the string is ordered by
 * code point — so the same capture always produces the same bytes.
 */
function joinByCodePoint(chars) {
  return [...chars].sort((left, right) => left.codePointAt(0) - right.codePointAt(0)).join('');
}

/**
 * Read the HTML of the four pages.
 *
 * Either from a local directory (`--html-dir`, one `<page>.html` per page)
 * or from the live site (`--base`).
 */
async function readPages(options) {
  const html = {};
  for (const page of PAGES) {
    if (options.htmlDir) {
      const file = join(options.htmlDir, `${page.file}.html`);
      try {
        html[page.path] = await readFile(file, 'utf8');
      } catch (error) {
        throw new Error(
          `the page ${page.path} cannot be read from ${file}: ${error.message}`,
        );
      }
      continue;
    }
    const url = `${options.base.replace(/\/+$/, '')}${page.path}`;
    let response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': 'pinyin-character-capture/1.0' },
      });
    } catch (error) {
      throw new Error(`the page ${page.path} cannot be fetched (${url}): ${error.message}`);
    }
    if (!response.ok) {
      throw new Error(`the page ${page.path} answers ${response.status} (${url})`);
    }
    html[page.path] = await response.text();
  }
  return html;
}

/**
 * The committed fixture.
 *
 * A fixture that cannot be read is not fatal — the capture still runs — but
 * the reason is kept and reported, because "the difference is empty" and
 * "there was nothing to compare with" must not look the same.
 *
 * The path is the committed fixture by default; `--fixture` points it
 * somewhere else, which is what makes the "there is no fixture to inherit
 * the metadata from" path reachable in a test.
 */
async function readFixture(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return { raw, parsed: JSON.parse(raw), error: null };
  } catch (error) {
    return { raw: null, parsed: null, error };
  }
}

/**
 * Print the difference against the committed fixture.
 *
 * The point of the fixture is to be REVIEWED before it is replaced, so the
 * difference is printed whether it is empty or not.
 */
function reportDifference(fixture, pages) {
  if (!fixture.parsed) {
    console.log(
      `[capture] there is no committed fixture to compare with: ` +
        `${fixture.error?.message ?? 'it is missing'}`,
    );
    return;
  }
  const oldPages = fixture.parsed.pages ?? {};
  let changed = 0;
  for (const page of PAGES) {
    const before = oldPages[page.path] ?? {};
    const after = pages[page.path] ?? {};
    for (const family of FAMILIES) {
      const beforeChars = new Set([...(before[family] ?? '')]);
      const afterChars = new Set([...(after[family] ?? '')]);
      const added = [...afterChars].filter((char) => !beforeChars.has(char));
      const removed = [...beforeChars].filter((char) => !afterChars.has(char));
      if (added.length > 0 || removed.length > 0) changed += 1;
      console.log(
        `[capture] ${page.path.padEnd(11)} ${family.padEnd(7)} ` +
          `${added.length} added, ${removed.length} removed` +
          (added.length > 0 ? ` (+${added.join('')})` : '') +
          (removed.length > 0 ? ` (-${removed.join('')})` : ''),
      );
    }
  }
  console.log(
    changed === 0
      ? '[capture] the capture is identical to the committed fixture'
      : `[capture] ${changed} page/family combination(s) differ from the committed fixture`,
  );
}

/**
 * The source the capture declares.
 *
 * It must be TRUE (G12): the JSON says where the characters came from, and
 * that claim travels into the fixture and from there into the measurement
 * of Task 9. A capture that claims the production site while it read local
 * files is a lie that hides itself.
 *
 *   1. `--source` says it — that is what the caller claims.
 *   2. A replay of a local capture inherits the source of the committed
 *      fixture: the replay reproduces that capture, byte for byte.
 *   3. A live capture reads the site of `--base`: that is where the
 *      characters really come from.
 *   4. A local capture with no fixture to inherit from says the honest
 *      thing — the characters come from the local directory. It must NOT
 *      claim the production site: it never went there.
 */
function resolveSource(options, fixture) {
  if (options.source) return options.source;
  if (!options.htmlDir) return options.base;
  if (fixture && typeof fixture.source === 'string' && fixture.source !== '') {
    return fixture.source;
  }
  return `local:${options.htmlDir}`;
}

/**
 * The CLI.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixture = await readFixture(options.fixture);

  console.log(
    options.htmlDir
      ? `[capture] reading the local captures of ${options.htmlDir}`
      : `[capture] fetching ${options.base}`,
  );
  if (!options.htmlDir) {
    console.log(
      '[capture] warning: the production site answers anonymous requests with the ' +
        '"initialised" page since 2026-10-29 — a live capture only sees what an ' +
        'anonymous visitor sees',
    );
  }

  const html = await readPages(options);

  const pages = {};
  for (const page of PAGES) {
    const sets = collectFamilyCharsets(html[page.path]);
    pages[page.path] = {
      sans: joinByCodePoint(sets.sans),
      serif: joinByCodePoint(sets.serif),
      wenkai: joinByCodePoint(sets.wenkai),
    };
  }

  // The metadata of a replay: a local capture replays an old capture, so
  // it keeps the metadata of that capture — otherwise the replay could
  // never reproduce the fixture byte for byte.
  const capturedAt =
    options.capturedAt ??
    (options.htmlDir && fixture.parsed ? fixture.parsed.capturedAt : today());
  const source = resolveSource(options, fixture.parsed);

  if (options.htmlDir && fixture.parsed && !options.capturedAt && !options.source) {
    console.log(
      `[capture] the metadata of the committed fixture is kept (capturedAt ` +
        `${capturedAt}, source ${source}) — use --captured-at and --source to change it`,
    );
  }

  const profile = { capturedAt, source, pages };
  const content = `${JSON.stringify(profile, null, 2)}\n`;

  reportDifference(fixture, pages);

  if (!options.out) {
    console.log('[capture] no --out given: the profile is printed below, nothing was written');
    process.stdout.write(content);
    return;
  }

  if (
    resolve(options.out) === FIXTURE_PATH &&
    fixture.parsed &&
    content !== fixture.raw &&
    !options.force
  ) {
    console.error(
      '[capture] the committed fixture is NOT overwritten: the capture differs from it ' +
        'and only the coordinator decides whether the fixture changes — pass --force to ' +
        'write it anyway',
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(dirname(resolve(options.out)), { recursive: true });
  await writeFile(options.out, content, 'utf8');
  console.log(
    `[capture] wrote ${options.out} (${Buffer.byteLength(content, 'utf8')} B)`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[capture] the capture failed: ${error.message}`);
    process.exitCode = 1;
  });
}
