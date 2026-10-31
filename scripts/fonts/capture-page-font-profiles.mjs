/**
 * scripts/fonts/capture-page-font-profiles.mjs — the regenerator of
 * data/font-page-profiles.json (the SEED of the hot tier) and of
 * data/font-page-sample.json (the SAMPLE of the live pages that the page
 * budget gate measures).
 *
 * The fixture records, for four pages, WHICH characters each of the three
 * typefaces paints. The hot tier of the webfont subsets is seeded from it
 * (scripts/fonts/webfont-charset.mjs), so it decides what a browser
 * downloads: a character the pages paint is in the hot tier, everything
 * else waits in an Ext block.
 *
 * ⚠️ The seed and the sample are two different files with two different
 * jobs, and the difference is written into them: the file says how many
 * ROUNDS it holds. The seed is one round (the hot tier is seeded from it);
 * the sample is the union of eight rounds, and it is the sample the page
 * budget gate measures. A sample of ONE round may be the deterministic
 * page — and then it is the seed, and the gate can never see the Ext
 * layer.
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
 *
 * ⚠️ The capture records TWO character sets per page and family: the
 * Chinese characters and the Latin ones. The fixture string is the Chinese
 * part FIRST and the Latin part AFTER it, so the Chinese part of the
 * committed fixture stays byte for byte the prefix it has always been — a
 * Latin capture can never rewrite the 7 936 Chinese subset files.
 *
 * ⚠️ A live capture MUST carry the initialization cookie and MUST check the
 * response before it measures anything: without `setup_completed=1` the site
 * answers with a 307 to `/init` whose body is FIVE bytes long, and a
 * capture that does not notice records the charset of the gate.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectFamilyCharsets, collectFamilyLatinCharsets } from '../perf/class-attribution.mjs';
import { DEFAULT_COOKIE, fetchPage } from '../perf/fetch-page.mjs';
import { isLatinChar } from './webfont-charset.mjs';

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
    cookie: DEFAULT_COOKIE,
    keepCjk: false,
    latinCapturedAt: null,
    latinSource: null,
    union: 1,
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
      case '--cookie':
        options.cookie = argv[++index];
        break;
      case '--latin-captured-at':
        options.latinCapturedAt = argv[++index];
        break;
      case '--latin-source':
        options.latinSource = argv[++index];
        break;
      case '--keep-cjk':
        options.keepCjk = true;
        break;
      case '--union': {
        const value = Number(argv[++index]);
        if (!Number.isInteger(value) || value < 1) {
          throw new Error(
            `--union needs a positive integer number of rounds, got ` +
              `${JSON.stringify(argv[index])}`,
          );
        }
        options.union = value;
        break;
      }
      case '--force':
        options.force = true;
        break;
      default:
        throw new Error(
          `unknown argument ${JSON.stringify(argument)} — the options are ` +
            '--base, --html-dir, --out, --captured-at, --source, --fixture, ' +
            '--cookie, --latin-captured-at, --latin-source, --keep-cjk, --union and --force',
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
    cookie: '--cookie',
    latinCapturedAt: '--latin-captured-at',
    latinSource: '--latin-source',
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
 *
 * ⚠️ The live read goes through `fetchPage` of `scripts/perf/fetch-page.mjs`:
 * it carries the initialization cookie and it REFUSES a response that is not
 * a page (status 200, `text/html`, more than 10 000 bytes). A 307 to
 * `/init` with a five byte body is the gate, not a page — a capture that
 * does not notice records the charset of the gate and the hot tier is seeded
 * with it.
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
      response = await fetchPage(url, { cookie: options.cookie });
    } catch (error) {
      throw new Error(`the page ${page.path} cannot be captured (${url}): ${error.message}`);
    }
    html[page.path] = response.body;
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
      '[capture] the live capture carries the initialization cookie ' +
        `(${options.cookie === '' ? 'none — on purpose' : options.cookie}) — without it ` +
        'the site answers with a 307 to /init and a body of five bytes, and the capture ' +
        'would record the charset of the gate',
    );
  }

  const rounds = [];
  for (let round = 0; round < options.union; round += 1) {
    rounds.push(await readPages(options));
  }
  if (options.union > 1) {
    console.log(
      `[capture] ${options.union} rounds were captured and their characters were ` +
        'united — the live pages serve a different selection of stories on every ' +
        'request, so one round is a sample of what a page paints, not the whole of it',
    );
  }

  // The two character sets of every page: the Chinese ones and the Latin
  // ones. They are collected with the SAME attribution rule (the same
  // module, the same walk) — only the accepted characters differ.
  //
  // ⚠️ The sets of the rounds are UNITED: the live pages are not
  // deterministic (two requests for `/stories` answer with two different
  // bodies), so a single round samples the page. A character the page
  // paints in one render and not in another is a character the page paints
  // — and a hot tier that holds only one sample of it lets the browser
  // fall back to the system font for the other renders.
  const cjkSets = {};
  const latinSets = {};
  for (const page of PAGES) {
    cjkSets[page.path] = { sans: new Set(), serif: new Set(), wenkai: new Set() };
    latinSets[page.path] = { sans: new Set(), serif: new Set(), wenkai: new Set() };
  }
  for (const html of rounds) {
    for (const page of PAGES) {
      const cjk = collectFamilyCharsets(html[page.path]);
      const latin = collectFamilyLatinCharsets(html[page.path]);
      for (const family of FAMILIES) {
        for (const ch of cjk[family]) cjkSets[page.path][family].add(ch);
        for (const ch of latin[family]) latinSets[page.path][family].add(ch);
      }
    }
  }

  const cjkPages = {};
  const latinPages = {};
  for (const page of PAGES) {
    cjkPages[page.path] = {
      sans: joinByCodePoint(cjkSets[page.path].sans),
      serif: joinByCodePoint(cjkSets[page.path].serif),
      wenkai: joinByCodePoint(cjkSets[page.path].wenkai),
    };
    latinPages[page.path] = {
      sans: joinByCodePoint(latinSets[page.path].sans),
      serif: joinByCodePoint(latinSets[page.path].serif),
      wenkai: joinByCodePoint(latinSets[page.path].wenkai),
    };
  }

  // ⚠️ The Chinese part of the committed fixture is the PREFIX of every
  // string, and it must stay byte for byte what it is. `--keep-cjk` takes
  // it from the committed fixture instead of from the capture: the live
  // pages have drifted since 2026-10-29, and a capture that rewrote the
  // Chinese part would rewrite the 7 936 Chinese subset files with it.
  let chinesePages = cjkPages;
  if (options.keepCjk) {
    if (!fixture.parsed) {
      throw new Error(
        '--keep-cjk needs the committed fixture to keep the Chinese part from ' +
          '— point --fixture at it, or drop --keep-cjk',
      );
    }
    const oldPages = fixture.parsed.pages ?? {};
    chinesePages = {};
    for (const page of PAGES) {
      const before = oldPages[page.path] ?? {};
      chinesePages[page.path] = {};
      for (const family of FAMILIES) {
        const kept = before[family];
        if (typeof kept !== 'string') {
          throw new Error(
            `--keep-cjk: the committed fixture has no ${family} string for ` +
              `${page.path} — the Chinese part cannot be kept`,
          );
        }
        // The committed string is "the Chinese characters and then the Latin
        // ones". The Chinese part is what is left after the Latin characters
        // are taken away — everything that is NOT a Latin character is kept,
        // in its order, byte for byte.
        chinesePages[page.path][family] = [...kept].filter((ch) => !isLatinChar(ch)).join('');
      }
    }
    console.log(
      '[capture] the Chinese part is kept from the committed fixture — only the ' +
        'Latin part comes from this capture',
    );
  }

  // The fixture string of a family: the Chinese characters FIRST, the Latin
  // ones AFTER them. Two sorted runs, not one sorted run — the Chinese part
  // is the prefix the committed fixture already has.
  const pages = {};
  for (const page of PAGES) {
    pages[page.path] = {};
    for (const family of FAMILIES) {
      pages[page.path][family] = chinesePages[page.path][family] + latinPages[page.path][family];
    }
  }

  // The metadata of a replay: a local capture replays an old capture, so
  // it keeps the metadata of that capture — otherwise the replay could
  // never reproduce the fixture byte for byte.
  //
  // ⚠️ The metadata of the CHINESE part belongs to the Chinese part: with
  // `--keep-cjk` the Chinese characters are the ones of the committed
  // fixture, so `capturedAt` and `source` are theirs too — a live Latin
  // capture must not claim that the Chinese characters of 2026-10-29 were
  // read today.
  const keepChinese = Boolean(options.keepCjk && fixture.parsed);
  const capturedAt =
    options.capturedAt ??
    (keepChinese || (options.htmlDir && fixture.parsed)
      ? fixture.parsed.capturedAt
      : today());
  const source =
    options.source ??
    (keepChinese ? fixture.parsed.source : resolveSource(options, fixture.parsed));

  // The metadata of the Latin part, which is a capture of its own: it says
  // WHEN the Latin characters were read and WHERE they came from.
  const latinCapturedAt =
    options.latinCapturedAt ??
    (options.htmlDir && fixture.parsed
      ? (fixture.parsed.latinCapturedAt ?? fixture.parsed.capturedAt)
      : today());
  const latinSource =
    options.latinSource ??
    (options.htmlDir && fixture.parsed
      ? (fixture.parsed.latinSource ?? fixture.parsed.source)
      : source);

  if (options.htmlDir && fixture.parsed && !options.capturedAt && !options.source) {
    console.log(
      `[capture] the metadata of the committed fixture is kept (capturedAt ` +
        `${capturedAt}, source ${source}) — use --captured-at and --source to change it`,
    );
  }

  // ⚠️ The number of rounds travels with the characters: a profile that
  // says it is the union of eight rounds can be told apart from a profile
  // of one round, and the budget gate needs the difference (a sample of one
  // round may be the deterministic page, and then it is the seed of the hot
  // tier, and the gate is circular).
  //
  // The sample of the live pages is written with:
  //   npm run fonts:capture-page-profiles -- --base https://ziyun.pudafo.com --union 8 \
  //     --out data/font-page-sample.json --captured-at 2026-10-31 --source https://ziyun.pudafo.com \
  //     --latin-captured-at 2026-10-31 --latin-source https://ziyun.pudafo.com
  const profile = {
    capturedAt,
    source,
    latinCapturedAt,
    latinSource,
    rounds: options.union,
    pages,
  };
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
