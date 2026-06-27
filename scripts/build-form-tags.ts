/**
 * One-shot backfill: infer `form` for poems where it is NULL.
 *
 * For each NULL-form row, runs:
 *   struct = inferFormFromParagraphs(contentLines)        // structural
 *   source = resolveFormFromSource(type, rhythmic, cat)   // source-tag (T2 work)
 *   merged = mergeForm(struct, source)                    // prefer source
 * If merged.primary != null → UPDATE poems SET form = ?.
 *
 * Flags:
 *   --dry-run          Compute, log, don't write
 *   --all              Process ALL rows (not just form IS NULL) — destructive
 *   --batch-size N     Override default 1000
 *
 * Idempotent: with default --all=false, only updates NULL rows. After T2
 * normalized 189 form-tagged rows, this backfills the remaining 435 NULL.
 *
 * Run:
 *   DATABASE_URL=mysql://root:Admin909217@127.0.0.1:3306/piyin_dev \
 *     pnpm tsx scripts/build-form-tags.ts
 *   DATABASE_URL=mysql://... pnpm tsx scripts/build-form-tags.ts --dry-run
 */
import { getPool, closePool } from '../lib/db';
import {
  inferFormFromParagraphs,
  resolveFormFromSource,
  mergeForm,
} from '../lib/poetry/infer-form';

interface BackfillArgs {
  batchSize?: number;
  dryRun?: boolean;
  whereFormNull?: boolean;
}

export interface BackfillResult {
  scanned: number;
  formSet: number;
  formNull: number;
  dryRun: boolean;
}

function parseJsonArray(s: unknown): string[] {
  if (Array.isArray(s)) return s as string[];
  if (typeof s === 'string') {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function backfillForm(args: BackfillArgs = {}): Promise<BackfillResult> {
  const pool = getPool();
  const batchSize = args.batchSize ?? 1000;
  const dryRun = args.dryRun ?? false;
  const whereFormNull = args.whereFormNull ?? true;
  const whereClause = whereFormNull ? 'WHERE form IS NULL' : '';
  let offset = 0;
  let scanned = 0;
  let formSet = 0;
  let formNull = 0;

  while (true) {
    const [rows] = await pool.query<any[]>(
      `SELECT id, category, dynasty, content, form FROM poems ${whereClause} ORDER BY id LIMIT ? OFFSET ?`,
      [batchSize, offset],
    );
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows as any[]) {
      scanned++;
      const paragraphs = parseJsonArray(row.content ?? row.paragraphs);
      const struct = inferFormFromParagraphs(paragraphs);
      // SELECT (line 69) does not fetch `type` / `rhythmic` — rows have neither.
      // Guard explicitly: only call resolveFormFromSource when at least one is
      // present, so a future maintainer who adds them to the SELECT sees the
      // inference change become intentional (audit §4.3).
      const hasSourceTag = typeof row.type === 'string' || typeof row.rhythmic === 'string';
      const source = hasSourceTag
        ? resolveFormFromSource(row.type, row.rhythmic, row.category || row.dynasty)
        : { primary: null, source: 'source-tag' as const, confidence: 0 };
      const merged = mergeForm(struct, source);
      if (merged.primary === null) {
        formNull++;
        continue;
      }
      if (!dryRun) {
        await pool.execute(`UPDATE poems SET form = ? WHERE id = ?`, [merged.primary, row.id]);
      }
      formSet++;
    }
    if (rows.length < batchSize) break;
    offset += batchSize;
  }

  console.log(
    `[build-form-tags] scanned=${scanned} formSet=${formSet} formNull=${formNull} dryRun=${dryRun}`,
  );
  return { scanned, formSet, formNull, dryRun };
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const all = process.argv.includes('--all');
  backfillForm({ dryRun, whereFormNull: !all })
    .then(() => closePool())
    .catch((err) => {
      console.error('[build-form-tags] failed:', err);
      process.exit(1);
    });
}
