import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getAllConfig: vi.fn(),
  setConfigBatch: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
}));

import { GET, PUT } from '@/app/api/admin/font-config/route';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';

const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedGetAllConfig = vi.mocked(getAllConfig);
const mockedSetConfigBatch = vi.mocked(setConfigBatch);
const mockedWriteAudit = vi.mocked(writeAudit);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({
    ok: true,
    user: { id: 1, username: 'admin', isAdmin: true },
  } as any);
  mockedSetConfigBatch.mockResolvedValue(undefined);
  mockedWriteAudit.mockResolvedValue(undefined);
});

describe('GET /api/admin/font-config', () => {
  it('returns era→font map merged with defaults', async () => {
    mockedGetAllConfig.mockResolvedValue({ 'era.jiaguwen.font': 'OracularInverted' });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      jiaguwen: 'OracularInverted',
      jinwen: 'WangHanzongWeibei',
      xiaozhuan: 'QuanZiKuShuoWen',
      lishu: 'WangHanzongLishu',
      kaishu: 'ZCOOLXiaoWei',
    });
  });

  it('returns 403 when not admin', async () => {
    mockedRequireAdmin.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: new Response(JSON.stringify({ error: 'admin required' }), { status: 403 }),
    } as any);
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/font-config', () => {
  it('accepts a valid full map and calls setConfigBatch + audit', async () => {
    const req = new NextRequest('http://localhost/api/admin/font-config', {
      method: 'PUT',
      body: JSON.stringify({
        jiaguwen: 'OracularInverted',
        jinwen: 'WangHanzongWeibei',
        xiaozhuan: 'QuanZiKuShuoWen',
        lishu: 'WangHanzongLishu',
        kaishu: 'ZCOOLXiaoWei',
      }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(mockedSetConfigBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        'era.jiaguwen.font': 'OracularInverted',
        'era.kaishu.font': 'ZCOOLXiaoWei',
      }),
      expect.anything(),
    );
    expect(mockedWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'admin.font_config.update' }),
    );
  });

  it('returns 400 when an invalid font id is submitted', async () => {
    const req = new NextRequest('http://localhost/api/admin/font-config', {
      method: 'PUT',
      body: JSON.stringify({
        jiaguwen: 'NotARealFont',
        jinwen: 'WangHanzongWeibei',
        xiaozhuan: 'QuanZiKuShuoWen',
        lishu: 'WangHanzongLishu',
        kaishu: 'ZCOOLXiaoWei',
      }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    expect(mockedSetConfigBatch).not.toHaveBeenCalled();
  });

  it('returns 403 when not admin', async () => {
    mockedRequireAdmin.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: new Response(JSON.stringify({ error: 'admin required' }), { status: 403 }),
    } as any);
    const req = new NextRequest('http://localhost/api/admin/font-config', {
      method: 'PUT',
      body: JSON.stringify({}),
    });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  it('accepts partial map (only changed eras) and only writes those keys', async () => {
    const req = new NextRequest('http://localhost/api/admin/font-config', {
      method: 'PUT',
      body: JSON.stringify({ jiaguwen: 'OracularInverted' }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(mockedSetConfigBatch).toHaveBeenCalledWith(
      { 'era.jiaguwen.font': 'OracularInverted' },
      expect.anything(),
    );
  });
});
