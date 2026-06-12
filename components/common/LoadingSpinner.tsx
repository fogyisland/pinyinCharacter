import { Loader2 } from 'lucide-react';

type Size = 'sm' | 'md' | 'lg';

const SIZE_MAP: Record<Size, number> = { sm: 16, md: 24, lg: 32 };

export function LoadingSpinner({ size = 'md', label }: { size?: Size; label?: string }) {
  const px = SIZE_MAP[size];
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-ink-faint">
      <div className="relative" style={{ width: px, height: px }}>
        <Loader2 size={px} className="animate-spin text-ink" />
        <span
          className="absolute inset-0 block"
          style={{
            borderTop: `2px solid #B22B2B`,
            borderRadius: '50%',
            transform: 'rotate(45deg)',
            animation: 'spin 1s linear infinite reverse',
          }}
        />
      </div>
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}
