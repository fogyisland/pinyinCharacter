'use client';

interface Props {
  label?: string;
  className?: string;
}

export function PrintButton({ label = '打印本页', className = 'rounded-md border border-ink/30 px-5 py-2 text-ink hover:bg-paper-deep' }: Props) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {label}
    </button>
  );
}
