import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { SCHEDULER_KEYS, writeSchedulerConfig } from '@/lib/scheduler-config';

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  queryMock.mockResolvedValue([{ affectedRows: 1 }]);
});

describe('writing the scheduler configuration', () => {
  it('persists the WeCom delivery toggle', async () => {
    // The admin toggles the delivery task ON THE SCHEDULER PAGE. The
    // toggle only works if the value survives the write AND the read.
    //
    // This is the third link of a four-link chain, and it is the one that
    // was easy to leave out: the schema accepts the key, the route passes
    // it through, the panel draws the switch — but if `writeSchedulerConfig`
    // never writes it, the admin's switch snaps back and nothing changes,
    // with no error anywhere. The zod strip and the missing label are
    // covered elsewhere; this covers the write.
    await writeSchedulerConfig({ taskWecomDeliver: false }, 1);

    const writes = queryMock.mock.calls.map((call) => call[1] as unknown[]);
    const wecomWrite = writes.find((params) => params[0] === SCHEDULER_KEYS.taskWecomDeliver);
    expect(wecomWrite, 'the WeCom delivery toggle was never written').toBeTruthy();
    expect(wecomWrite?.[1]).toBe('0');
  });

  it('persists the WeCom delivery toggle being turned back on', async () => {
    await writeSchedulerConfig({ taskWecomDeliver: true }, 1);

    const writes = queryMock.mock.calls.map((call) => call[1] as unknown[]);
    const wecomWrite = writes.find((params) => params[0] === SCHEDULER_KEYS.taskWecomDeliver);
    expect(wecomWrite, 'the WeCom delivery toggle was never written').toBeTruthy();
    expect(wecomWrite?.[1]).toBe('1');
  });
});
