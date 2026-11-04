import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/setup', () => ({
  isSetupRouteEnabled: vi.fn(),
  markSetupComplete: vi.fn(),
  markInitWizardAdminDone: vi.fn(),
}));

const runMigrationsMock = vi.fn();
vi.mock('@/scripts/migrate', () => ({
  runMigrations: () => runMigrationsMock(),
}));

const initDbMock = vi.fn();
vi.mock('@/scripts/init-db', () => ({
  initDb: () => initDbMock(),
}));

import { POST } from '@/app/api/init/run-seed/route';
import {
  isSetupRouteEnabled,
  markSetupComplete,
  markInitWizardAdminDone,
} from '@/lib/setup';

const mockedRouteEnabled = vi.mocked(isSetupRouteEnabled);
const mockedMarkComplete = vi.mocked(markSetupComplete);
const mockedMarkAdminDone = vi.mocked(markInitWizardAdminDone);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRouteEnabled.mockResolvedValue(true);
  mockedMarkComplete.mockResolvedValue(undefined);
  mockedMarkAdminDone.mockResolvedValue(true);
  runMigrationsMock.mockResolvedValue({ files: 3, statements: 42 });
  initDbMock.mockResolvedValue(undefined);
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://u:p@127.0.0.1:3306/pinyin_test';
});

describe('POST /api/init/run-seed — the wizard step-2 marker', () => {
  it('writes the step-2 marker after initDb has created the table', async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    expect(initDbMock).toHaveBeenCalled();
    expect(mockedMarkAdminDone).toHaveBeenCalled();
  });

  it('writes the marker AFTER the tables exist, not before', async () => {
    const order: string[] = [];
    initDbMock.mockImplementation(async () => {
      order.push('initDb');
    });
    mockedMarkAdminDone.mockImplementation(async () => {
      order.push('markAdminDone');
      return true;
    });

    await POST();

    expect(order).toEqual(['initDb', 'markAdminDone']);
  });

  it('does not fail the whole seed when the marker cannot be written', async () => {
    // The marker is a convenience for re-entry, not a requirement of the
    // seed: by now the tables exist and the admin account has been created.
    // If the marker cannot be written, the seed still succeeded and saying
    // 500 would wrongly tell the admin that setup failed.
    mockedMarkAdminDone.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockedMarkComplete).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('reports that the marker was not written', async () => {
    mockedMarkAdminDone.mockResolvedValue(false);

    const res = await POST();
    const body = await res.json();

    expect(body.data.markerWritten).toBe(false);
  });
});
