import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the db module BEFORE importing activation. The actual mysql2 pool
// is irrelevant — we want to control the return values to exercise the
// defensive null/error paths.
const mockQuery = vi.fn();
const mockExecute = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({
    query: mockQuery,
    execute: mockExecute,
  }),
}));

const importActivation = () => import('../../../lib/activation');

describe('lib/activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset process.env so DATABASE_URL gating is deterministic
    delete process.env.DATABASE_URL;
  });

  describe('getActivationStatus', () => {
    it('returns null when DATABASE_URL is not set', async () => {
      const { getActivationStatus } = await importActivation();
      expect(await getActivationStatus()).toBeNull();
    });

    it('returns null when the activate row is missing', async () => {
      process.env.DATABASE_URL = 'mysql://x';
      mockQuery.mockResolvedValueOnce([[]]);
      const { getActivationStatus } = await importActivation();
      expect(await getActivationStatus()).toBeNull();
    });

    it('returns null on DB error (defensive)', async () => {
      process.env.DATABASE_URL = 'mysql://x';
      mockQuery.mockRejectedValueOnce(new Error('table not found'));
      const { getActivationStatus } = await importActivation();
      expect(await getActivationStatus()).toBeNull();
    });

    it('maps the singleton row into ActivationStatus', async () => {
      process.env.DATABASE_URL = 'mysql://x';
      mockQuery.mockResolvedValueOnce([[{
        short_name: 'prod-server-1',
        is_activated: 1,
        activated_at: new Date('2026-06-01'),
        is_expired: 0,
        expire_date: new Date('2027-01-01'),
        lock: 0,
        last_heartbeat_at: new Date('2026-06-24'),
        last_cloud_sync_at: new Date('2026-06-25'),
        cloud_endpoint: 'https://www.booming.one',
        installation_data: { hostname: 'prod-server-1' },
      }]]);
      const { getActivationStatus } = await importActivation();
      const s = await getActivationStatus();
      expect(s).toEqual({
        shortName: 'prod-server-1',
        isActivated: true,
        activatedAt: expect.any(Date),
        isExpired: false,
        expireDate: expect.any(Date),
        isLocked: false,
        lastHeartbeatAt: expect.any(Date),
        lastCloudSyncAt: expect.any(Date),
        cloudEndpoint: 'https://www.booming.one',
        installationData: { hostname: 'prod-server-1' },
      });
    });
  });

  describe('isLocked', () => {
    it('returns false when status is null (defensive)', async () => {
      const { isLocked } = await importActivation();
      expect(await isLocked()).toBe(false);
    });

    it('returns true when lock=1 in DB', async () => {
      process.env.DATABASE_URL = 'mysql://x';
      mockQuery.mockResolvedValueOnce([[{ short_name: 'x', is_activated: 0, activated_at: null, is_expired: 0, expire_date: null, lock: 1, last_heartbeat_at: null, last_cloud_sync_at: null, cloud_endpoint: null, installation_data: null }]]);
      const { isLocked } = await importActivation();
      expect(await isLocked()).toBe(true);
    });
  });

  describe('isExpired', () => {
    it('returns false when status is null', async () => {
      const { isExpired } = await importActivation();
      expect(await isExpired()).toBe(false);
    });

    it('returns true when is_expired=1 in DB', async () => {
      process.env.DATABASE_URL = 'mysql://x';
      mockQuery.mockResolvedValueOnce([[{ short_name: 'x', is_activated: 0, activated_at: null, is_expired: 1, expire_date: null, lock: 0, last_heartbeat_at: null, last_cloud_sync_at: null, cloud_endpoint: null, installation_data: null }]]);
      const { isExpired } = await importActivation();
      expect(await isExpired()).toBe(true);
    });

    it('returns true when expire_date is in the past', async () => {
      process.env.DATABASE_URL = 'mysql://x';
      const past = new Date(Date.now() - 86400_000);
      mockQuery.mockResolvedValueOnce([[{ short_name: 'x', is_activated: 0, activated_at: null, is_expired: 0, expire_date: past, lock: 0, last_heartbeat_at: null, last_cloud_sync_at: null, cloud_endpoint: null, installation_data: null }]]);
      const { isExpired } = await importActivation();
      expect(await isExpired()).toBe(true);
    });

    it('returns false when is_expired=0 and expire_date is in the future', async () => {
      process.env.DATABASE_URL = 'mysql://x';
      const future = new Date(Date.now() + 86400_000);
      mockQuery.mockResolvedValueOnce([[{ short_name: 'x', is_activated: 0, activated_at: null, is_expired: 0, expire_date: future, lock: 0, last_heartbeat_at: null, last_cloud_sync_at: null, cloud_endpoint: null, installation_data: null }]]);
      const { isExpired } = await importActivation();
      expect(await isExpired()).toBe(false);
    });
  });

  describe('clearLock / setLock', () => {
    it('clearLock issues UPDATE lock=0 on id=1', async () => {
      process.env.DATABASE_URL = 'mysql://x';
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });
      const { clearLock } = await importActivation();
      await clearLock();
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE activate'),
        [1],
      );
    });

    it('setLock(true) sets lock=1', async () => {
      process.env.DATABASE_URL = 'mysql://x';
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });
      // Audit call is best-effort and uses the same pool — mock it to succeed
      mockQuery.mockResolvedValueOnce([{ insertId: 1 }]);
      const { setLock } = await importActivation();
      await setLock(true, 42);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE activate'),
        [1, 1],
      );
    });
  });
});
