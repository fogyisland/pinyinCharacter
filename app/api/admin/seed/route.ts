import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { SEED_DATASETS } from '@/lib/seed-registry';
import { readSeedCounts, runSeedDataset } from '@/lib/seed-runner';

export const dynamic = 'force-dynamic';

/**
 * The content seed screen's API.
 *
 * `GET` reports how many rows each seeded dataset holds and how many the
 * repository ships. `POST` fills the gap for one dataset or for all of
 * them.
 *
 * The counts and the fills both come from `lib/seed-registry.ts` and
 * `lib/seed-runner.ts` — the same modules the boot path and the CLI use,
 * so the screen can never disagree with them about what a dataset is.
 */
export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const counts = await readSeedCounts();
    const datasets = SEED_DATASETS.map((dataset) => {
      const actual = counts[dataset.id] ?? 0;
      return {
        id: dataset.id,
        label: dataset.label,
        table: dataset.table,
        dependsOn: dataset.dependsOn,
        expected: dataset.expected,
        actual,
        missing: Math.max(0, dataset.expected - actual),
        complete: actual >= dataset.expected,
        manualCommand: dataset.manualCommand,
      };
    });

    return NextResponse.json({ ok: true, data: { datasets } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return badRequest('validation', 'a JSON body is required');
    }

    const requested = (body as { only?: unknown }).only;
    let only: string[];
    if (requested === undefined || requested === null) {
      only = [];
    } else if (typeof requested === 'string') {
      only = [requested];
    } else if (Array.isArray(requested) && requested.every((v) => typeof v === 'string')) {
      only = requested as string[];
    } else {
      return badRequest('validation', 'only must be a string or an array of strings');
    }

    const known = new Set(SEED_DATASETS.map((d) => d.id));
    const unknown = only.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return badRequest(
        'validation',
        `unknown dataset id(s): ${unknown.join(', ')}. Known ids: ${[...known].join(', ')}`,
      );
    }

    const targets = only.length === 0 ? SEED_DATASETS : SEED_DATASETS.filter((d) => only.includes(d.id));

    // The fills run one after another. A dataset that fails does not stop
    // the others — a broken etymology import must not prevent the HSK
    // grading, the one thing the games area needs, from being seeded.
    const outcomes = [];
    for (const dataset of targets) {
      outcomes.push(await runSeedDataset(dataset.id, { dryRun: false }));
    }

    const failed = outcomes.filter((o) => o.status === 'failed');
    await writeAudit({
      userId: auth.user.id,
      event: 'admin_content_seed_run',
      metadata: {
        datasets: targets.map((d) => d.label),
        failed: failed.map((o) => o.datasetId),
        inserted: outcomes.reduce((sum, o) => sum + o.inserted, 0),
      },
    });

    const counts = await readSeedCounts();
    const datasets = SEED_DATASETS.map((dataset) => {
      const actual = counts[dataset.id] ?? 0;
      return {
        id: dataset.id,
        label: dataset.label,
        table: dataset.table,
        dependsOn: dataset.dependsOn,
        expected: dataset.expected,
        actual,
        missing: Math.max(0, dataset.expected - actual),
        complete: actual >= dataset.expected,
        manualCommand: dataset.manualCommand,
      };
    });

    return NextResponse.json({ ok: true, data: { outcomes, datasets } });
  });
}
