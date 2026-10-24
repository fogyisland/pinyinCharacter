import Link from 'next/link';
import { AlertCircle, RefreshCw } from 'lucide-react';

type Props = {
  title?: string;
  message: string;
  code?: string;
  onRetry?: () => void;
  /**
   * Href of a retry link. Server-rendered pages cannot hand a callback to
   * the client, so they point the retry at a URL instead.
   */
  retryHref?: string;
};

export function ErrorState({ title = '出错了', message, code, onRetry, retryHref }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <AlertCircle size={36} strokeWidth={1.5} className="text-seal mb-3" />
      <h3 className="text-base font-semibold text-ink mb-1">{title}</h3>
      <p className="text-sm text-ink-soft max-w-md mb-2">{message}</p>
      {code && <code className="text-xs text-ink-faint font-mono mb-4">[{code}]</code>}
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost flex items-center gap-2 mt-2">
          <RefreshCw size={14} /> 重试
        </button>
      )}
      {!onRetry && retryHref && (
        <Link href={retryHref} className="btn-ghost flex items-center gap-2 mt-2">
          <RefreshCw size={14} /> 重试
        </Link>
      )}
      <div className="paper-rule w-24 mt-6" />
    </div>
  );
}
