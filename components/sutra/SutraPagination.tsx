'use client';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
}

export function SutraPagination({ page, pageSize, total, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-6 text-sm">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-3 py-1.5 border border-ink/20 rounded disabled:opacity-40 hover:border-seal"
      >
        上一页
      </button>
      <span className="text-ink-soft">第 {page} / {totalPages} 页</span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-3 py-1.5 border border-ink/20 rounded disabled:opacity-40 hover:border-seal"
      >
        下一页
      </button>
    </div>
  );
}
