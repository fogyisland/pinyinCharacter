import { describe, it, expect } from 'vitest';
import { charsListQuerySchema, charParamSchema, etymologyCharParamSchema } from '@/lib/validators';

describe('charsListQuerySchema', () => {
  it('defaults page=1', () => {
    const r = charsListQuerySchema.parse({});
    expect(r.page).toBe(1);
  });
  it('coerces page string', () => {
    const r = charsListQuerySchema.parse({ page: '3' });
    expect(r.page).toBe(3);
  });
  it('rejects level > 3', () => {
    expect(() => charsListQuerySchema.parse({ level: '4' })).toThrow();
  });
  it('accepts level 1/2/3', () => {
    expect(charsListQuerySchema.parse({ level: '1' }).level).toBe(1);
    expect(charsListQuerySchema.parse({ level: '2' }).level).toBe(2);
    expect(charsListQuerySchema.parse({ level: '3' }).level).toBe(3);
  });
  it('letter is single uppercase A-Z', () => {
    expect(charsListQuerySchema.parse({ letter: 'A' }).letter).toBe('A');
    expect(() => charsListQuerySchema.parse({ letter: 'abc' })).toThrow();
    expect(() => charsListQuerySchema.parse({ letter: '1' })).toThrow();
  });
});

describe('charParamSchema', () => {
  it('accepts single CJK char', () => {
    expect(charParamSchema.parse({ char: '一' }).char).toBe('一');
  });
  it('rejects multi-char', () => {
    expect(() => charParamSchema.parse({ char: '你好' })).toThrow();
  });
  it('rejects empty', () => {
    expect(() => charParamSchema.parse({ char: '' })).toThrow();
  });
});

describe('etymologyCharParamSchema', () => {
  it('same as charParamSchema (alias)', () => {
    expect(etymologyCharParamSchema.parse({ char: '龘' }).char).toBe('龘');
  });
});