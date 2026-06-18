import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { adminGenerateCharsSchema } from '@/lib/validators';
import { processOneField, emptyPerField, ALL_FIELDS, type FieldName } from '@/lib/admin-char-gen';
import { logUserAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const parsed = adminGenerateCharsSchema.safeParse(body);
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');

    const requested: FieldName[] = (Object.keys(parsed.data.fields) as FieldName[]).filter(
      (k) => parsed.data.fields[k as keyof typeof parsed.data.fields],
    );

    const pool = getPool();
    const model = (await getConfig('ai.model')) ?? 'gpt-4o-mini';
    const perField = emptyPerField();

    let llmCalls = 0;
    for (const char of parsed.data.chars) {
      for (const field of requested) {
        if (llmCalls > 0) await sleep(1000);
        llmCalls++;
        try {
          const result = await processOneField(pool, auth.user.id, model, char, field);
          if (result === 'generated') perField[field].generated++;
          else perField[field].skipped++;
        } catch (err) {
          perField[field].errors.push({ char, message: (err as Error).message });
        }
      }
    }

    const totals = { generated: 0, skipped: 0, errors: [] as { char: string; message: string }[] };
    for (const r of Object.values(perField)) {
      totals.generated += r.generated;
      totals.skipped += r.skipped;
      totals.errors.push(...r.errors);
    }

    await logUserAction(req, auth.user.id, 'admin_chars_generated', {
      chars: parsed.data.chars,
      fields: requested,
      generated: totals.generated,
      skipped: totals.skipped,
      total: totals.generated + totals.skipped,
      errors: totals.errors.length,
    });

    return NextResponse.json({
      ok: true,
      data: { perField, totals },
    });
  });
}
