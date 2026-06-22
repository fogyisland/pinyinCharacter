import { NextRequest, NextResponse } from 'next/server';
import { listPoems } from '@/lib/poetry';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { poemListQuerySchema } from '@/lib/validators';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = poemListQuerySchema.safeParse({
      dynasty: sp.get('dynasty') ?? undefined,
      category: sp.get('category') ?? undefined,
      forms: sp.get('forms') ?? undefined,
      q: sp.get('q') ?? undefined,
      page: sp.get('page') ?? undefined,
      pageSize: sp.get('pageSize') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const forms = parsed.data.forms
      ? parsed.data.forms.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    const result = await listPoems({
      dynasty: parsed.data.dynasty,
      category: parsed.data.category ?? null,
      forms,
      q: parsed.data.q,
      form: undefined,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}