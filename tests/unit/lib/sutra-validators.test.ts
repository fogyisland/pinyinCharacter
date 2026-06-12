import { describe, it, expect } from 'vitest';
import { sutraListQuerySchema, sutraIdParamSchema } from '@/lib/validators';

describe('sutra validators', () => {
  it('sutraListQuerySchema accepts empty input', () => {
    expect(() => sutraListQuerySchema.parse({})).not.toThrow();
  });
  it('sutraListQuerySchema coerces page number', () => {
    const r = sutraListQuerySchema.parse({ page: '3' });
    expect(r.page).toBe(3);
  });
  it('sutraListQuerySchema rejects negative page', () => {
    expect(() => sutraListQuerySchema.parse({ page: '-1' })).toThrow();
  });
  it('sutraIdParamSchema coerces numeric id string', () => {
    const r = sutraIdParamSchema.parse({ id: '42' });
    expect(r.id).toBe(42);
  });
  it('sutraIdParamSchema rejects non-numeric', () => {
    expect(() => sutraIdParamSchema.parse({ id: 'abc' })).toThrow();
  });
});
