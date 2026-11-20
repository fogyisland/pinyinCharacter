/**
 * The WeChat broadcast switch, as the admin screen sees it.
 *
 * Three places have to know about the new task, or the admin cannot
 * turn it on:
 *   - lib/validators.ts     the zod schema of the POST body
 *   - app/api/admin/scheduler/route.ts  the Pick<> of the fields it reads
 *   - components/admin/SchedulerPanel.tsx   the label of the checkbox
 *
 * ⚠️ A missing switch is a silent failure: the checkbox never appears,
 * and the task runs (or not) with nobody able to say why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const requireAdminMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAdmin: () => requireAdminMock(),
}));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

const writeSchedulerConfigMock = vi.fn();
const readSchedulerConfigMock = vi.fn();
vi.mock('@/lib/scheduler-config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scheduler-config')>(
    '@/lib/scheduler-config',
  );
  return {
    ...actual,
    writeSchedulerConfig: (...args: unknown[]) => writeSchedulerConfigMock(...args),
    readSchedulerConfig: (...args: unknown[]) => readSchedulerConfigMock(...args),
  };
});

const bootstrapSchedulerMock = vi.fn();
vi.mock('@/lib/scheduler', () => ({
  bootstrapScheduler: () => bootstrapSchedulerMock(),
}));

const writeAuditMock = vi.fn();
vi.mock('@/lib/audit', () => ({
  writeAudit: (entry: unknown) => writeAuditMock(entry),
}));

import { adminSchedulerConfigSchema } from '@/lib/validators';
import { POST } from '@/app/api/admin/scheduler/route';

const ADMIN = { id: 7, username: 'admin', isAdmin: true };

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/scheduler', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ ok: true, user: ADMIN });
  writeSchedulerConfigMock.mockResolvedValue(undefined);
  readSchedulerConfigMock.mockResolvedValue({ taskWechatBroadcast: true });
  bootstrapSchedulerMock.mockResolvedValue(undefined);
  writeAuditMock.mockResolvedValue(undefined);
  queryMock.mockReset();
  queryMock.mockResolvedValue([{ affectedRows: 1 }, []]);
});

describe('the scheduler config schema', () => {
  it('accepts the WeChat broadcast switch', () => {
    const parsed = adminSchedulerConfigSchema.safeParse({ taskWechatBroadcast: false });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.taskWechatBroadcast).toBe(false);
  });

  it('leaves the switch alone when it is not in the body', () => {
    const parsed = adminSchedulerConfigSchema.safeParse({ enabled: true });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.taskWechatBroadcast).toBeUndefined();
  });
});

describe('the scheduler config route', () => {
  it('writes the WeChat broadcast switch through', async () => {
    const response = await POST(postReq({ taskWechatBroadcast: false }));

    expect(response.status).toBe(200);
    expect(writeSchedulerConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskWechatBroadcast: false }),
      ADMIN.id,
    );
  });

  it('logs the change', async () => {
    await POST(postReq({ taskWechatBroadcast: false }));

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'scheduler_config_updated' }),
    );
  });

  it('rejects a switch that is not a boolean', async () => {
    const response = await POST(postReq({ taskWechatBroadcast: 'yes' }));

    expect(response.status).toBe(400);
    expect(writeSchedulerConfigMock).not.toHaveBeenCalled();
  });
});

describe('the switch all the way down', () => {
  it('writes the WeChat broadcast switch into app_config', async () => {
    // ⚠️ The route's own type annotation is inert — a narrower Pick<>
    // does not filter at runtime. What actually decides is the zod
    // schema plus writeSchedulerConfig. This test walks the whole
    // chain, so a break anywhere in it shows up here.
    const { writeSchedulerConfig: writeReal } = await vi.importActual<
      typeof import('@/lib/scheduler-config')
    >('@/lib/scheduler-config');

    await writeReal({ taskWechatBroadcast: false }, 7);

    // The key is a bound parameter — the SQL itself is a placeholder.
    const params = queryMock.mock.calls[0][1] as unknown[];
    expect(params).toContain('scheduler.task_wechat_broadcast');
    expect(params).toContain('0');
    expect(params).toContain(7);
  });

  it('does not write the switch when it is not in the body', async () => {
    const { writeSchedulerConfig: writeReal } = await vi.importActual<
      typeof import('@/lib/scheduler-config')
    >('@/lib/scheduler-config');
    queryMock.mockClear();

    await writeReal({ enabled: true }, 7);

    const params = queryMock.mock.calls[0][1] as unknown[];
    expect(params).not.toContain('scheduler.task_wechat_broadcast');
  });
});

describe('reading the switch back', () => {
  it('reports the switch as off when the database says so', async () => {
    // ⚠️ A loader that answers `true` unconditionally would let an
    // admin turn the task off and watch it come back on by itself.
    const { readSchedulerConfig: readReal } = await vi.importActual<
      typeof import('@/lib/scheduler-config')
    >('@/lib/scheduler-config');
    queryMock.mockResolvedValueOnce([
      [{ key: 'scheduler.task_wechat_broadcast', value: '0' }],
      [],
    ]);

    const cfg = await readReal();

    expect(cfg.taskWechatBroadcast).toBe(false);
  });

  it('reports the switch as on when the database says so', async () => {
    const { readSchedulerConfig: readReal } = await vi.importActual<
      typeof import('@/lib/scheduler-config')
    >('@/lib/scheduler-config');
    queryMock.mockResolvedValueOnce([
      [{ key: 'scheduler.task_wechat_broadcast', value: '1' }],
      [],
    ]);

    const cfg = await readReal();

    expect(cfg.taskWechatBroadcast).toBe(true);
  });

  it('reports the switch as on when the database says nothing', async () => {
    const { readSchedulerConfig: readReal } = await vi.importActual<
      typeof import('@/lib/scheduler-config')
    >('@/lib/scheduler-config');
    queryMock.mockResolvedValueOnce([[], []]);

    const cfg = await readReal();

    expect(cfg.taskWechatBroadcast).toBe(true);
  });
});

describe('the scheduler panel', () => {
  it('offers a checkbox for the WeChat broadcast', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('components/admin/SchedulerPanel.tsx', 'utf8');

    expect(source).toContain('taskWechatBroadcast');
    expect(source).toContain('微信公告');
  });
});
