import Link from 'next/link';

interface Props {
  page: number;
  total: number;
  pageSize: number;
  basePath: string;
  q: string;
}

export function RareCharPagination({ page, total, pageSize, basePath, q }: Props) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (p > 1) params.set('page', String(p));
    return `${basePath}${params.toString() ? '?' + params.toString() : ''}`;
  };

  return (
    <nav className="flex items-center justify-center gap-2 py-4">
      {page > 1 && (
        <Link href={buildHref(page - 1)} className="rounded border px-3 py-1 hover:bg-paper-deep">
          上一页
        </Link>
      )}
      <span className="text-sm text-ink-soft">
        第 {page} / {last} 页
      </span>
      {page < last && (
        <Link href={buildHref(page + 1)} className="rounded border px-3 py-1 hover:bg-paper-deep">
          下一页
        </Link>
      )}
    </nav>
  );
}
