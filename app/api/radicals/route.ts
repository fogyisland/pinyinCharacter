import { NextResponse } from 'next/server';
import radicals from '@/data/radicals.json';

// 24h client cache: 字典数据不常变,客户端按需拉一次
export const dynamic = 'force-static';

export async function GET() {
  return NextResponse.json(radicals, {
    headers: {
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}