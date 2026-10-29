import { describe, it, expect, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTANCER_TARGETS, instancerArgs } from '../../../scripts/fonts/instance-webfont-axis.mjs';
import {
  SOURCES,
  DOWNLOAD_TIMEOUT_MS,
  MAX_ATTEMPTS_PER_URL,
  // No `.ts` extension on this import: the repo tsconfig does not enable
  // `allowImportingTsExtensions`, so an explicit `.ts` specifier is a
  // TS5097 error. The extensionless form resolves to the same file.
} from '../../../scripts/fonts/download-webfont-sources';

describe('download-webfont-sources', () => {
  it('downloads the four source fonts plus their licences', () => {
    expect(SOURCES.map((s) => s.filename).sort()).toEqual(
      [
        'LXGWWenKaiTC-Bold.ttf',
        'LXGWWenKaiTC-OFL.txt',
        'LXGWWenKaiTC-Regular.ttf',
        'NotoSansSC-OFL.txt',
        'NotoSansSC-wght.ttf',
        'NotoSerifSC-OFL.txt',
        'NotoSerifSC-wght.ttf',
      ].sort(),
    );
  });

  it('points every source at an https github raw url', () => {
    for (const source of SOURCES) {
      expect(source.urls.length).toBeGreaterThan(0);
      for (const url of source.urls) {
        expect(url.startsWith('https://raw.githubusercontent.com/')).toBe(true);
      }
    }
  });

  it('waits long enough for a 25 MB font and retries every url', () => {
    // The 60 s default of the hard-pen downloader is far too short here:
    // the serif source is 25 125 512 bytes.
    expect(DOWNLOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);
    expect(MAX_ATTEMPTS_PER_URL).toBeGreaterThanOrEqual(2);
  });
});

describe('instance-webfont-axis', () => {
  it('reports a missing Python interpreter as a missing interpreter', async () => {
    // The interpreter is read from the environment when the module is
    // loaded, so the module registry is reset to get a fresh instance
    // that sees the bogus interpreter.
    vi.resetModules();
    const previous = process.env.PYTHON;
    process.env.PYTHON = 'pinyin-no-such-python-interpreter';
    try {
      const instancer = (await import(
        '../../../scripts/fonts/instance-webfont-axis.mjs'
      )) as unknown as {
        describeFontTools: () => {
          ok: boolean;
          moduleMissing: boolean;
          interpreterMissing: boolean;
          detail: string;
        };
      };

      const probe = instancer.describeFontTools();

      expect(probe.ok).toBe(false);
      expect(probe.interpreterMissing).toBe(true);
      // The interpreter never ran, so nothing at all is known about
      // fontTools. Saying "fontTools is missing" here would be a lie.
      expect(probe.moduleMissing).toBe(false);
      expect(probe.detail).toMatch(/not found/i);
    } finally {
      if (previous === undefined) {
        delete process.env.PYTHON;
      } else {
        process.env.PYTHON = previous;
      }
      vi.resetModules();
    }
  });

  it('reports an interpreter that cannot be started as an interpreter problem', async () => {
    // The file exists but cannot be executed: POSIX answers EACCES,
    // Windows answers EFTYPE. The errno differs per platform, so the
    // assertion matches the shape of the errno instead of naming one.
    const dir = mkdtempSync(join(tmpdir(), 'webfont-interpreter-'));
    const probePath = join(dir, 'pinyin-no-exec-probe.py');
    writeFileSync(probePath, 'this file is not an interpreter\n');
    if (process.platform !== 'win32') {
      chmodSync(probePath, 0o000);
    }

    vi.resetModules();
    const previous = process.env.PYTHON;
    process.env.PYTHON = probePath;
    try {
      const instancer = (await import(
        '../../../scripts/fonts/instance-webfont-axis.mjs'
      )) as unknown as {
        describeFontTools: () => {
          ok: boolean;
          moduleMissing: boolean;
          interpreterMissing: boolean;
          detail: string;
        };
      };

      const probe = instancer.describeFontTools();

      expect(probe.ok).toBe(false);
      // The subprocess never started, so this is an interpreter
      // problem — whatever fontTools is installed or not.
      expect(probe.interpreterMissing).toBe(true);
      expect(probe.moduleMissing).toBe(false);
      // The original errno has to survive into the message.
      expect(probe.detail).toMatch(/E[A-Z]+/);
    } finally {
      if (previous === undefined) {
        delete process.env.PYTHON;
      } else {
        process.env.PYTHON = previous;
      }
      vi.resetModules();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pins the wght axis to the four weights the site uses', () => {
    expect(instancerArgs('src.ttf', 'out.ttf')).toEqual([
      '-I',
      '-m',
      'fontTools.varLib.instancer',
      'src.ttf',
      'wght=400:700',
      '--output',
      'out.ttf',
      '--no-overlap-flag',
    ]);
  });

  it('runs the interpreter in isolated mode', () => {
    // -I keeps the interpreter from putting the script directory and the
    // working directory on sys.path, so a stray json.py cannot shadow the
    // standard library.
    expect(instancerArgs('src.ttf', 'out.ttf')[0]).toBe('-I');
    expect(instancerArgs('src.ttf', 'out.ttf')[1]).toBe('-m');
  });

  it('instances only the two variable fonts', () => {
    expect(INSTANCER_TARGETS.map((t) => t.src).sort()).toEqual([
      'NotoSansSC-wght.ttf',
      'NotoSerifSC-wght.ttf',
    ]);
  });

  it('keeps the declaration file and the runtime module in sync', async () => {
    // The .d.mts is hand written. Without this guard the module can drift
    // away from it: tsc stays green (it believes the declaration) while
    // the runtime module no longer exports the name at all.
    const declaration = readFileSync(
      fileURLToPath(new URL('../../../scripts/fonts/instance-webfont-axis.d.mts', import.meta.url)),
      'utf8',
    );

    const declaredFunctions = [...declaration.matchAll(/export declare (?:async )?function (\w+)/g)].map(
      (match) => match[1],
    );
    const declaredConstants = [...declaration.matchAll(/export declare const (\w+): ([^;]+);/g)].map(
      (match) => ({ name: match[1], type: match[2].trim() }),
    );
    expect(declaredFunctions.length).toBeGreaterThan(0);
    expect(declaredConstants.length).toBeGreaterThan(0);

    const runtime = (await import(
      '../../../scripts/fonts/instance-webfont-axis.mjs'
    )) as unknown as Record<string, unknown>;

    for (const name of declaredFunctions) {
      expect(runtime, `the .mjs no longer exports ${name}`).toHaveProperty(name);
      expect(typeof runtime[name], `${name} should be a function`).toBe('function');
    }

    for (const { name, type } of declaredConstants) {
      expect(runtime, `the .mjs no longer exports ${name}`).toHaveProperty(name);
      const value = runtime[name];
      if (type === 'string') {
        expect(typeof value, `${name} should be a string`).toBe('string');
      } else if (type === 'number') {
        expect(typeof value, `${name} should be a number`).toBe('number');
      } else if (type === 'boolean') {
        expect(typeof value, `${name} should be a boolean`).toBe('boolean');
      } else if (type.endsWith('[]')) {
        expect(Array.isArray(value), `${name} should be an array`).toBe(true);
      } else {
        expect(value, `${name} should be an object`).toBeTypeOf('object');
      }
    }
  });
});
