import { describe, it, expect } from 'vitest';
import * as hist from '@/lib/history';

describe('history lib exports', () => {
  it('exports CRUD functions', () => {
    expect(typeof hist.createHistory).toBe('function');
    expect(typeof hist.listHistory).toBe('function');
    expect(typeof hist.setFavorite).toBe('function');
    expect(typeof hist.deleteHistory).toBe('function');
    expect(typeof hist.getStats).toBe('function');
    expect(typeof hist.findRecentDuplicate).toBe('function');
  });
});
