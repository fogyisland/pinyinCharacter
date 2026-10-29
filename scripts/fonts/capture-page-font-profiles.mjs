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
      case '--force':
        options.force = true;
        break;
      default:
        throw new Error(
          `unknown argument ${JSON.stringify(argument)} — the options are ` +
            '--base, --html-dir, --out, --captured-at, --source and --force',
        );
    }
  }
  const flags = {
    base: '--base',
    htmlDir: '--html-dir',
    out: '--out',
    capturedAt: '--captured-at',
    source: '--source',
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
 */
async function readFixture() {
  try {
    const raw = await readFile(FIXTURE_PATH, 'utf8');
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
 * The CLI.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixture = await readFixture();

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
  const source =
    options.source ??
    (options.htmlDir && fixture.parsed ? fixture.parsed.source : options.base);

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
