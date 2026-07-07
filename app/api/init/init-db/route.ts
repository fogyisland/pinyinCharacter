import { NextResponse } from 'next/server';

const STALE_BUILD_BODY = {
  ok: false,
  error: {
    code: 'stale_build',
    message:
      '请硬刷新浏览器 (Ctrl+Shift+R) 后重试。这是旧版 wizard 的端点,新版已分拆为 /init/db + /init/admin + /init/execute。',
  },
};

/** 410 Gone — this endpoint was deleted in commit a00c6106 (replaced by
 *  the per-phase /api/init/init-* endpoints). Old client bundles may still
 *  POST here; we return a clear message telling the user to hard-refresh. */
export async function POST() {
  return NextResponse.json(STALE_BUILD_BODY, { status: 410 });
}

export async function GET() {
  return NextResponse.json(STALE_BUILD_BODY, { status: 410 });
}
