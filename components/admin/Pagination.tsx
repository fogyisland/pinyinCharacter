import { AdminLink } from '@/components/admin/AdminButton';

export interface PaginationProps {
  /** The 1-based page currently shown. */
  page: number;
  /** How many pages there are in total (values below 1 are treated as 1). */
  totalPages: number;
  /** How many records exist across all pages. */
  total: number;
  /** How many records one page holds. */
  pageSize: number;
  /** The href of a target page — the page owns its own filter state. */
  buildHref: (page: number) => string;
  /** The unit word printed after the counts, e.g. "条" or "人". */
  unit?: string;
}

const disabledClass = 'opacity-50 pointer-events-none';

/**
 * The page switcher shared by every paged admin list.
 *
 * Each list keeps its filters in the query string, so the page — not this
 * component — decides what a target page's URL looks like; `buildHref` turns
 * a page number into that URL. Keeping the layout in one place means the
 * seven paged lists cannot drift apart in wording or styling.
 */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  buildHref,
  unit = '条',
}: PaginationProps) {
  const pages = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <span className="text-xs text-ink-faint tabular-nums">
        {total === 0
          ? `共 0 ${unit}`
          : `第 ${from}–${to} ${unit} · 共 ${total} ${unit} · 第 ${current} / ${pages} 页`}
      </span>
      <nav className="flex gap-2" aria-label="分页">
        <AdminLink
          href={buildHref(current - 1)}
          variant="secondary"
          size="sm"
          aria-disabled={current <= 1}
          className={current <= 1 ? disabledClass : ''}
        >
          上一页
        </AdminLink>
        <AdminLink
          href={buildHref(current + 1)}
          variant="secondary"
          size="sm"
          aria-disabled={current >= pages}
          className={current >= pages ? disabledClass : ''}
        >
          下一页
        </AdminLink>
      </nav>
    </div>
  );
}
