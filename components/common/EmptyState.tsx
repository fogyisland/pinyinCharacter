import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

type Props = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="text-ink-faint mb-3">
        {icon ?? <Inbox size={32} strokeWidth={1.5} />}
      </div>
      <h3 className="text-base font-semibold text-ink mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-ink-soft max-w-md mb-4">{description}</p>
      )}
      {action}
      <div className="paper-rule w-24 mt-6" />
    </div>
  );
}
