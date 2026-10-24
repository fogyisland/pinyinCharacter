'use client';

import { useRouter } from 'next/navigation';
import { Filter } from 'lucide-react';
import {
  AI_STATUS_OPTIONS,
  buildAiHref,
  parseAiStatus,
  type AiCallsQuery,
} from '@/lib/admin-ai-url';

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
    <form
      onSubmit={apply}
      className="card-paper rounded-lg p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end"
    >
      <div>
        <label className="text-xs text-ink-soft" htmlFor="ai-calls-feature">
          功能
        </label>
        <input
          id="ai-calls-feature"
          name="feature"
          defaultValue={query.feature}
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
          placeholder="如 rare-char-story"
        />
      </div>
      <div>
        <label className="text-xs text-ink-soft" htmlFor="ai-calls-status">
          状态
        </label>
        <select
          id="ai-calls-status"
          name="status"
          defaultValue={query.status}
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        >
          {AI_STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-ink-soft" htmlFor="ai-calls-user-id">
          用户 ID
        </label>
        <input
          id="ai-calls-user-id"
          name="userId"
          defaultValue={query.userId}
          type="text"
          placeholder="数字 ID"
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        />
      </div>
      <div>
        <label className="text-xs text-ink-soft" htmlFor="ai-calls-from">
          从
        </label>
        <input
          id="ai-calls-from"
          name="from"
          defaultValue={query.from}
          type="date"
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        />
      </div>
      <div>
        <label className="text-xs text-ink-soft" htmlFor="ai-calls-to">
          至
        </label>
        <input
          id="ai-calls-to"
          name="to"
          defaultValue={query.to}
          type="date"
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="flex-1 text-sm px-3 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 inline-flex items-center justify-center gap-1"
        >
          <Filter className="h-3.5 w-3.5" />
          筛选
        </button>
        <button
          type="button"
          onClick={reset}
          className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep"
        >
          重置
        </button>
      </div>
    </form>
  );
}
