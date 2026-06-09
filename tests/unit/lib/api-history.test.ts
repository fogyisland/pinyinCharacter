import { describe, it, expect } from 'vitest';
import * as api from '@/lib/api-history';

describe('api-history exports', () => {
  it('exposes the 5 fetch wrappers', () => {
    expect(typeof api.listHistoryRequest).toBe('function');
    expect(typeof api.createHistoryRequest).toBe('function');
    expect(typeof api.setFavoriteRequest).toBe('function');
    expect(typeof api.deleteHistoryRequest).toBe('function');
    expect(typeof api.statsRequest).toBe('function');
  });
});