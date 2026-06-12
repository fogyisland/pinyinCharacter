'use client';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function PoemPagination({ page, pageSize, total, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="flex items-center justify-center gap-2 mt-6 text-sm">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={!canPrev}
        className="px-3 py-1 rounded border border-ink/20 hover:bg-paper-deep disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ← 上一页
      </button>
      <span className="text-ink-soft">
        第 {page} / {totalPages} 页 · 共 {total} 首
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={!canNext}
        className="px-3 py-1 rounded border border-ink/20 hover:bg-paper-deep disabled:opacity-30 disabled:cursor-not-allowed"
      >
        下一页 →
      </button>
    </div>
  );
}
