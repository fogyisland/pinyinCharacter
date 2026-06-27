import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
};

export function PageContainer({ children, className = '' }: Props) {
  return (
    <main className={`max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 ${className}`}>
      {children}
    </main>
  );
}

export function SectionTitle({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <div className="mb-4 sm:mb-6">
      <h2 className="font-kai text-2xl sm:text-3xl text-ink leading-tight">{children}</h2>
      {subtitle && <p className="text-sm text-ink-soft mt-1">{subtitle}</p>}
      <div className="paper-rule w-16 mt-3" />
    </div>
  );
}
