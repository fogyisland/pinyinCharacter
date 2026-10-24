'use client';

import { useRouter } from 'next/navigation';
import { Filter } from 'lucide-react';
import {
  AI_STATUS_OPTIONS,
  buildAiHref,
  parseAiStatus,
  type AiCallsQuery,
} from '@/lib/admin-ai-url';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';

/** Read a form field as a trimmed string. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The /admin/ai call filter bar.
 *
 * A small client island: the page itself renders on the server, and this
 * island only turns the form into a query string and navigates to it.
 *
 * The bar sits inside the page's `Toolbar`, so it only lays its fields out
 * — the bar's own frame belongs to the toolbar.
 */
export function AiCallsFilterBar({ query }: { query: AiCallsQuery }) {
  const router = useRouter();

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    router.push(
      buildAiHref('calls', query, {
        feature: field(form, 'feature'),
        status: parseAiStatus(field(form, 'status')),
        userId: field(form, 'userId'),
        from: field(form, 'from'),
        to: field(form, 'to'),
        page: 1,
      }),
    );
  }

  function reset() {
    router.push('/admin/ai');
  }

  return (
    <form onSubmit={apply} className="grid w-full grid-cols-1 md:grid-cols-6 gap-2 items-end">
      <FormField label="功能" htmlFor="ai-calls-feature">
        <input
          id="ai-calls-feature"
          name="feature"
          defaultValue={query.feature}
          className="adm-input"
          placeholder="如 rare-char-story"
        />
      </FormField>
      <FormField label="状态" htmlFor="ai-calls-status">
        <select
          id="ai-calls-status"
          name="status"
          defaultValue={query.status}
          className="adm-input"
        >
          {AI_STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="用户 ID" htmlFor="ai-calls-user-id">
        <input
          id="ai-calls-user-id"
          name="userId"
          defaultValue={query.userId}
          type="text"
          placeholder="数字 ID"
          className="adm-input"
        />
      </FormField>
      <FormField label="从" htmlFor="ai-calls-from">
        <input
          id="ai-calls-from"
          name="from"
          defaultValue={query.from}
          type="date"
          className="adm-input"
        />
      </FormField>
      <FormField label="至" htmlFor="ai-calls-to">
        <input
          id="ai-calls-to"
          name="to"
          defaultValue={query.to}
          type="date"
          className="adm-input"
        />
      </FormField>
      <div className="flex gap-2">
        <AdminButton type="submit" variant="primary" icon={<Filter className="h-3.5 w-3.5" />}>
          筛选
        </AdminButton>
        <AdminButton type="button" onClick={reset} variant="secondary" size="md">
          重置
        </AdminButton>
      </div>
    </form>
  );
}
