'use client';

import { useRouter } from 'next/navigation';
import { Filter } from 'lucide-react';
import {
  LOG_EVENT_GROUPS,
  LOG_SOURCE_OPTIONS,
  buildLogsHref,
  parseLogSource,
  type LogsQuery,
} from '@/lib/admin-logs-url';

/** Read a form field as a trimmed string. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The /admin/logs filter bar.
 *
 * A small client island: the page itself renders on the server, and this
 * island only turns the form into a query string and navigates to it. The
 * `key` on the island (set by the page) remounts it whenever the query
 * changes, so the inputs always show the state the server rendered.
 */
export function LogsFilterBar({ query }: { query: LogsQuery }) {
  const router = useRouter();

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    router.push(
      buildLogsHref(query, {
        source: parseLogSource(field(form, 'source')),
        type: field(form, 'type'),
        userId: field(form, 'userId'),
        ip: field(form, 'ip'),
        from: field(form, 'from'),
        to: field(form, 'to'),
        page: 1,
      }),
    );
  }

  function reset() {
    router.push('/admin/logs');
  }

  return (
    <form
      onSubmit={apply}
      className="card-paper rounded-lg p-3 grid grid-cols-1 md:grid-cols-7 gap-2 items-end"
    >
      <div className="md:col-span-1">
        <label className="text-xs text-ink-soft" htmlFor="logs-source">
          来源
        </label>
        <select
          id="logs-source"
          name="source"
          defaultValue={query.source}
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        >
          {LOG_SOURCE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-1">
        <label className="text-xs text-ink-soft" htmlFor="logs-type">
          事件
        </label>
        <select
          id="logs-type"
          name="type"
          defaultValue={query.type}
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        >
          <option value="">全部事件</option>
          {LOG_EVENT_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="md:col-span-1">
        <label className="text-xs text-ink-soft" htmlFor="logs-user-id">
          用户 ID
        </label>
        <input
          id="logs-user-id"
          name="userId"
          defaultValue={query.userId}
          type="number"
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        />
      </div>
      <div className="md:col-span-1">
        <label className="text-xs text-ink-soft" htmlFor="logs-ip">
          IP
        </label>
        <input
          id="logs-ip"
          name="ip"
          defaultValue={query.ip}
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        />
      </div>
      <div className="md:col-span-1">
        <label className="text-xs text-ink-soft" htmlFor="logs-from">
          从
        </label>
        <input
          id="logs-from"
          name="from"
          defaultValue={query.from}
          type="date"
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        />
      </div>
      <div className="md:col-span-1">
        <label className="text-xs text-ink-soft" htmlFor="logs-to">
          至
        </label>
        <input
          id="logs-to"
          name="to"
          defaultValue={query.to}
          type="date"
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        />
      </div>
      <div className="md:col-span-1 flex gap-2">
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
