import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
};

export function PageContainer({ children, className = '' }: Props) {
  return (
    <main className={`max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-10 ${className}`}>
      {children}
    </main>
  );
}

export function SectionTitle({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <div className="publication-heading">
      <h2>{children}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}
