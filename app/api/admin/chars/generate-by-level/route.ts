import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { adminGenerateByLevelSchema } from '@/lib/validators';
import {
  processOneField,
  emptyPerField,
  type FieldName,
} from '@/lib/admin-char-gen';

export const dynamic = 'force-dynamic';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const parsed = adminGenerateByLevelSchema.safeParse(body);
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');

    const { level, fields, offset, limit, concurrency } = parsed.data;
    const requested: FieldName[] = (Object.keys(fields) as FieldName[]).filter(
      (k) => fields[k as keyof typeof fields],
    );

    const pool = getPool();
    const model = (await getConfig('ai.model')) ?? 'gpt-4o-mini';

    const [countRows] = await pool.query<any[]>(
      `SELECT COUNT(*) AS n FROM chars WHERE level = ?`,
      [level],
    );
    const totalChars = Number(countRows[0].n);

    const startMs = Date.now();
    const perField = emptyPerField();

    if (offset >= totalChars) {
      return NextResponse.json({
        ok: true,
        data: {
          done: true,
          totalChars,
          processed: 0,
          nextOffset: offset,
          elapsedMs: 0,
          perField,
        },
      });
    }

    const [chars] = await pool.query<any[]>(
      `SELECT \`char\`, pinyin, meaning_zh FROM chars WHERE level = ? ORDER BY id LIMIT ? OFFSET ?`,
      [level, limit, offset],
    );

    // Build flat work list: for each (char, field) pair, one processOneField call.
    const work: { char: string; field: FieldName }[] = [];
    for (const c of chars) {
      for (const f of requested) work.push({ char: c.char, field: f });
    }

    // Run in parallel sub-batches of size `concurrency`, with 200ms pause between sub-batches.
    for (let i = 0; i < work.length; i += concurrency) {
      const sub = work.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        sub.map((w) => processOneField(pool, auth.user.id, model, w.char, w.field)),
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const { char, field } = sub[j];
        if (r.status === 'rejected') {
          perField[field].errors.push({ char, message: (r.reason as Error).message });
        } else if (r.value === 'generated') {
          perField[field].generated++;
        } else {
          perField[field].skipped++;
        }
      }
      if (i + concurrency < work.length) await sleep(200);
    }

    const nextOffset = offset + chars.length;
    return NextResponse.json({
      ok: true,
      data: {
        done: nextOffset >= totalChars,
        totalChars,
        processed: chars.length,
        nextOffset,
        elapsedMs: Date.now() - startMs,
        perField,
      },
    });
  });
}
