import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export function StatCard({ label, value, icon: Icon, href }: {
  label: string; value: string | number; icon: LucideIcon; href?: string;
}) {
  const content = (
    <div className="rounded-lg border border-paper-warm bg-paper p-4 flex items-center gap-3 hover:bg-paper-warm transition-colors">
      <Icon className="h-6 w-6 text-seal shrink-0" />
      <div>
        <div className="text-xs text-ink-soft">{label}</div>
        <div className="text-2xl font-serif text-ink">{value}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
