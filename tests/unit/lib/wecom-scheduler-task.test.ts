import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

const deliverMock = vi.fn();
vi.mock('@/lib/wecom-deliver', () => ({
  runWecomDeliver: (...args: unknown[]) => deliverMock(...args),
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ALL_TASKS, runTask } from '@/lib/scheduler-tasks';
import { DEFAULT_CONFIG, SCHEDULER_KEYS } from '@/lib/scheduler-config';
import { adminSchedulerConfigSchema } from '@/lib/validators';

const mockedDeliver = vi.mocked(deliverMock);

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  deliverMock.mockReset();
});

describe('the WeCom delivery task', () => {
  it('is registered in the task list', () => {
    expect(ALL_TASKS).toContain('wecom-deliver');
  });

  it('has a configuration key', () => {
    expect(SCHEDULER_KEYS.taskWecomDeliver).toBe('scheduler.task_wecom_deliver');
    expect(DEFAULT_CONFIG.taskWecomDeliver).toBe(true);
  });

  it('runs the delivery and reports what it pushed', async () => {
    mockedDeliver.mockResolvedValue({ sent: 3, failed: 1, skipped: 0 });
    const result = await runTask('wecom-deliver');
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('sent=3');
    expect(result.summary).toContain('failed=1');
  });

  it('reports a failure without throwing', async () => {
    mockedDeliver.mockRejectedValue(new Error('db gone'));
    const result = await runTask('wecom-deliver');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('db gone');
  });

  it('is accepted by the admin config schema', async () => {
    // zod's z.object() SILENTLY DROPS the keys it does not declare — it
    // does not error. So if the schema does not mention taskWecomDeliver,
    // the admin's toggle sends a body that parses fine, returns 200, and
    // changes nothing. The toggle would look like it works and not work.
    const parsed = adminSchedulerConfigSchema.parse({ taskWecomDeliver: false });
    expect(parsed.taskWecomDeliver).toBe(false);
  });

  it('is listed in the task labels of the scheduler panel', async () => {
    // The panel's TASK_LABELS is what the operator actually sees. A task
    // with no label is a task with no switch.
    const panel = readFileSync(
      join(process.cwd(), 'components', 'admin', 'SchedulerPanel.tsx'),
      'utf8',
    );
    expect(panel).toContain('taskWecomDeliver');
    expect(panel).toContain('企业微信转发');
  });
});
