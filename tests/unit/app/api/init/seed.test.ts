import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/setup', () => ({
  isSetupRouteEnabled: vi.fn(),
}));

const runAllSeedsMock = vi.fn();
vi.mock('@/lib/seed-runner', () => ({
  runAllSeeds: (options: { dryRun: boolean }) => runAllSeedsMock(options),
}));

import { POST } from '@/app/api/init/seed/route';
import { isSetupRouteEnabled } from '@/lib/setup';

const mockedRouteEnabled = vi.mocked(isSetupRouteEnabled);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRouteEnabled.mockResolvedValue(true);
  runAllSeedsMock.mockResolvedValue([
    { datasetId: 'hsk-grading', status: 'seeded', actual: 2632, inserted: 2632 },
  ]);
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || 'mysql://u:p@127.0.0.1:3306/pinyin_test';
});

describe('POST /api/init/seed', () => {
  it('seeds every dataset', async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    expect(runAllSeedsMock).toHaveBeenCalledWith({ dryRun: false });
  });

  it('reports what each dataset ended up with', async () => {
    const res = await POST();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.data.seeds).toEqual([
      { datasetId: 'hsk-grading', status: 'seeded', actual: 2632, inserted: 2632 },
    ]);
  });

  it('does not seed when the route is locked', async () => {
    mockedRouteEnabled.mockResolvedValueOnce(false);

    const res = await POST();

    expect(res.status).toBe(400);
    expect(runAllSeedsMock).not.toHaveBeenCalled();
  });

  it('does not seed when DATABASE_URL is missing', async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const res = await POST();

      expect(res.status).toBe(400);
      expect(runAllSeedsMock).not.toHaveBeenCalled();
    } finally {
      process.env.DATABASE_URL = original;
    }
  });

  it('answers no-store, so a browser cannot replay an old seed result', async () => {
    const res = await POST();

    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
