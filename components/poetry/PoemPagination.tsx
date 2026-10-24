import Link from 'next/link';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the href of a page link; the current query is kept intact. */
  buildHref: (page: number) => string;
}

const BUTTON_CLASS =
  'px-3 py-1 rounded border border-ink/20 hover:bg-paper-deep disabled:opacity-30 disabled:cursor-not-allowed';

/**
 * Pagination of the /poetry list.
 *
 * The pages are plain links now, so the list is reachable without
 * JavaScript and the next page is prefetched by the router.
 */
export function PoemPagination({ page, pageSize, total, buildHref }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="flex items-center justify-center gap-2 mt-6 text-sm">
      {canPrev ? (
        <Link href={buildHref(page - 1)} className={BUTTON_CLASS}>
          ← 上一页
        </Link>
      ) : (
        <span className={BUTTON_CLASS} aria-disabled="true">
          ← 上一页
        </span>
      )}
      <span className="text-ink-soft">
        第 {page} / {totalPages} 页 · 共 {total} 首
      </span>
      {canNext ? (
        <Link href={buildHref(page + 1)} className={BUTTON_CLASS}>
          下一页 →
        </Link>
      ) : (
        <span className={BUTTON_CLASS} aria-disabled="true">
          下一页 →
        </span>
      )}
    </div>
  );
}
