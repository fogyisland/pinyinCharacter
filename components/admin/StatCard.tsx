import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export function StatCard({
  label,
  value,
  icon: Icon,
  href,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  href?: string;
}) {
  const content = (
    <div className="rounded-lg border border-ink/10 bg-paper-soft p-4 flex items-center gap-3 transition-colors hover:border-seal/40">
      <Icon className="h-6 w-6 text-seal shrink-0" />
      <div className="min-w-0">
        <div className="text-xs text-ink-soft">{label}</div>
        <div className="text-2xl font-serif text-ink tabular-nums truncate">{value}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
