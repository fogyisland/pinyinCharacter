'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, RefreshCw } from 'lucide-react';
import { AdminButton } from '@/components/admin/AdminButton';
import { StatusBadge } from '@/components/admin/StatusBadge';

/** A table the database does not have. */
export interface MissingTableRow {
  table: string;
  source: string;
}

/** A column the database does not have, on a table that exists. */
export interface MissingColumnRow {
  table: string;
  column: string;
  source: string;
}

/** What the API reports about the schema. */
export interface SchemaComparisonRow {
  missingTables: MissingTableRow[];
  missingColumns: MissingColumnRow[];
  actualTables: number;
  expectedTables: number;
  actualColumns: number;
  expectedColumns: number;
  upToDate: boolean;
}

/**
 * The schema migration panel.
 *
 * The seed panel above it answers "is the content complete?". This one
 * answers the question that comes first and is easier to miss: **is the
 * database's STRUCTURE behind the code?**
 *
 * The two look alike on screen but fail differently. Content that is
 * short shows up as an empty list or a zero score. A schema that is
 * behind shows up as `ER_NO_SUCH_TABLE` on one feature area while
 * everything else works — a site that looks alive and is quietly broken
 * in one corner. And there is no way to see it from the outside: the
 * `/init` wizard that would fix it has locked itself out by then.
 *
 * So the panel names what is missing — the table, the column, and the
 * file that should have created it — and offers the one-click fix. The
 * migrations are idempotent, so running them when nothing is missing is
 * harmless; the button stays available because "I think the server is
 * behind" is a reasonable thing to want to check.
 */
export function SchemaMigratePanel({ comparison }: { comparison: SchemaComparisonRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const missingTables = comparison.missingTables;
  const missingColumns = comparison.missingColumns;
  const missingCount = missingTables.length + missingColumns.length;

  async function runMigrations() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/migrate', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) {
        // The route keeps the database's own words — "ER_DUP_FIELDNAME
        // at 2026-07-04-hsk-level.sql" — because the generic envelope
        // would have replaced them with "server error".
        setError(json.error?.message ?? `迁移失败 (HTTP ${res.status})`);
        return;
      }
      const migrations = json.data?.migrations as { files?: number; statements?: number } | undefined;
      setNotice(
        `迁移完成 — ${migrations?.files ?? 0} 个文件 / ${migrations?.statements ?? 0} 条语句。` +
          '每个迁移文件都是幂等的，没有新变更时不会改动任何东西。',
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-faint">
          {comparison.upToDate
            ? '结构已是最新 — 数据库包含代码声明的全部表和列。'
            : `结构落后 ${missingCount} 项 — ${missingTables.length} 张表、${missingColumns.length} 个列缺失。`}
          <span className="ml-1">
            表 {comparison.actualTables.toLocaleString('en-US')} / 期望 {comparison.expectedTables.toLocaleString('en-US')}
            {' · '}
            列 {comparison.actualColumns.toLocaleString('en-US')} / 期望 {comparison.expectedColumns.toLocaleString('en-US')}
          </span>
        </p>
        <AdminButton
          variant="primary"
          size="sm"
          icon={<RefreshCw size={14} />}
          disabled={busy}
          onClick={() => void runMigrations()}
        >
          {busy ? '迁移中…' : '运行迁移'}
        </AdminButton>
      </div>

      {error ? (
        <div className="rounded border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded border border-success/30 bg-success/8 px-3 py-2 text-xs text-success">
          {notice}
        </div>
      ) : null}

      {missingCount > 0 ? (
        <div className="space-y-2">
          {missingTables.map((missing) => (
            <div
              key={`table:${missing.table}`}
              className="rounded border border-warning/30 bg-warning/6 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1"
            >
              <Database size={14} className="text-warning shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-sm text-ink">{missing.table}</code>
                  <StatusBadge tone="warning">缺表</StatusBadge>
                </div>
                <p className="text-xs text-ink-faint mt-0.5">
                  应由 <code>{missing.source}</code> 创建
                </p>
              </div>
            </div>
          ))}

          {missingColumns.map((missing) => (
            <div
              key={`column:${missing.table}.${missing.column}`}
              className="rounded border border-warning/30 bg-warning/6 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1"
            >
              <Database size={14} className="text-warning shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-sm text-ink">{missing.table}.{missing.column}</code>
                  <StatusBadge tone="warning">缺列</StatusBadge>
                </div>
                <p className="text-xs text-ink-faint mt-0.5">
                  应由 <code>{missing.source}</code> 添加
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
