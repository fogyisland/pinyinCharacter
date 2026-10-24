import Link from 'next/link';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the href of a page link; the current query is kept intact. */
  buildHref: (page: number) => string;
}

/**
 * Pagination of the /sutra list.
 *
 * The pages are plain links now, so the list is reachable without
 * JavaScript and the next page is prefetched by the router.
 */
export function SutraPagination({ page, pageSize, total, buildHref }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-6 text-sm">
      {page > 1 ? (
        <Link
          href={buildHref(page - 1)}
          className="px-3 py-1.5 border border-ink/20 rounded hover:border-seal"
        >
          上一页
        </Link>
      ) : (
        <span className="px-3 py-1.5 border border-ink/20 rounded opacity-40">上一页</span>
      )}
      <span className="text-ink-soft">
        第 {page} / {totalPages} 页
      </span>
      {page < totalPages ? (
        <Link
          href={buildHref(page + 1)}
          className="px-3 py-1.5 border border-ink/20 rounded hover:border-seal"
        >
          下一页
        </Link>
      ) : (
        <span className="px-3 py-1.5 border border-ink/20 rounded opacity-40">下一页</span>
      )}
    </div>
  );
}
