import { describe, it, expect } from 'vitest';
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
});
