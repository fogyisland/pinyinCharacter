import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const PATH = resolve(ROOT, 'public/manifest.json');

describe('public/manifest.json (F1)', () => {
  const manifest = JSON.parse(readFileSync(PATH, 'utf8'));

  it('has the required name and short_name', () => {
    expect(manifest.name).toBe('字·韵');
    expect(manifest.short_name).toBe('字·韵');
  });

  it('has the brand theme_color and paper background_color', () => {
    expect(manifest.theme_color).toBe('#5A4530');
    expect(manifest.background_color).toBe('#FBF7EC');
  });

  it('has a 32x32 icon entry pointing at /icon.png', () => {
    const i32 = manifest.icons.find((i: any) => i.sizes === '32x32');
    expect(i32).toBeDefined();
    expect(i32.src).toBe('/icon.png');
    expect(i32.type).toBe('image/png');
  });

  it('has a 180x180 apple icon entry', () => {
    const i180 = manifest.icons.find((i: any) => i.sizes === '180x180');
    expect(i180).toBeDefined();
    expect(i180.src).toBe('/apple-icon.png');
    expect(i180.type).toBe('image/png');
  });

  it('display is "standalone" and start_url is "/"', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
  });
});