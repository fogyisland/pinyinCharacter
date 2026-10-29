import { describe, it, expect } from 'vitest';
import {
  FAMILIES,
  renderStylesheet,
  blockFileNames,
  manifestVersion,
} from '../../../scripts/fonts/build-webfont-subsets.mjs';
import { loadFamilyCharsets } from '../../../scripts/fonts/webfont-charset.mjs';

const plan = {
  hot: ['一', '丁'],
  extBlocks: [{ index: 1, chars: ['万', '丈'] }],
};

describe('blockFileNames', () => {
  it('uses one file per block for the variable families', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    expect(blockFileNames(sans, { kind: 'hot' })).toEqual(['hot.woff2']);
    expect(blockFileNames(sans, { kind: 'ext', index: 3 })).toEqual(['ext-003.woff2']);
    expect(blockFileNames(sans, { kind: 'ext', index: 123 })).toEqual(['ext-123.woff2']);
  });

  it('uses one file per weight for the static kai family', () => {
    const kai = FAMILIES.find((f) => f.key === 'wenkai')!;
    expect(blockFileNames(kai, { kind: 'ext', index: 3 })).toEqual([
      'ext-003-400.woff2',
      'ext-003-700.woff2',
    ]);
  });
});

describe('renderStylesheet', () => {
  it('declares one face per block for a variable family', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain("font-family: 'Noto Sans SC'");
    expect(css).not.toContain('Noto Sans SC 1');
    expect(css).toContain('font-weight: 400 700');
  });

  it('declares one face per weight for the static kai family', () => {
    const kai = FAMILIES.find((f) => f.key === 'wenkai')!;
    const css = renderStylesheet(kai, plan);
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-weight: 700');
  });

  it('gives every face a unicode-range and font-display swap', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan);
    const faces = css.split('@font-face').slice(1);
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      expect(face).toContain('font-display: swap');
      expect(face).toMatch(/unicode-range: U\+/);
    }
  });

  it('points every face at /font/web/<family>/<file>', () => {
    const sans = FAMILIES.find((f) => f.key === 'sans')!;
    const css = renderStylesheet(sans, plan);
    expect(css).toContain("src: url(/font/web/sans/hot.woff2) format('woff2')");
    expect(css).toContain("src: url(/font/web/sans/ext-001.woff2) format('woff2')");
  });
});

describe('manifestVersion', () => {
  it('is twelve lowercase hex characters', () => {
    expect(manifestVersion({ 'fonts-sans.css': 'a' })).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes when the stylesheet changes and is stable otherwise', () => {
    const a = manifestVersion({ 'fonts-sans.css': 'a' });
    const b = manifestVersion({ 'fonts-sans.css': 'b' });
    expect(a).not.toBe(b);
    expect(manifestVersion({ 'fonts-sans.css': 'a' })).toBe(a);
  });
});

describe('the planned charsets fit the design budget', () => {
  it('produces a hot tier and ext blocks for every family', () => {
    const plans = loadFamilyCharsets();
    for (const family of FAMILIES) {
      const p = plans[family.key];
      expect(p.extBlocks.length).toBeGreaterThan(0);
      expect(p.hot.length).toBe(300);
    }
  }, 180_000);
});
