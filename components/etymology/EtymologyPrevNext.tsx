import Link from 'next/link';

interface Props {
  prev: string | null;
  next: string | null;
}

export function EtymologyPrevNext({ prev, next }: Props) {
  return (
    <div className="mt-6 flex justify-between text-sm">
      {prev ? (
        <Link
          href={`/etymology/${encodeURIComponent(prev)}`}
          className="text-ink-soft hover:text-ink"
        >
          ← 上一字「{prev}」
        </Link>
      ) : (
        <span className="text-ink-faint">已是第一个字</span>
      )}
      {next ? (
        <Link
          href={`/etymology/${encodeURIComponent(next)}`}
          className="text-ink-soft hover:text-ink"
        >
          下一字「{next}」→
        </Link>
      ) : (
        <span className="text-ink-faint">已是最后一个字</span>
      )}
    </div>
  );
}
