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
import { Toolbar } from '@/components/admin/Toolbar';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';

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
 *
 * The layout is the shared one — a `Toolbar` with a `FormField` per
 * control — so this bar lines up with the downloads and AI bars instead of
 * carrying a third set of spacing rules.
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
    <Toolbar>
      <form
        onSubmit={apply}
        className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6 md:items-end"
      >
        <FormField label="来源" htmlFor="logs-source">
          <select
            id="logs-source"
            name="source"
            defaultValue={query.source}
            className="adm-input"
          >
            {LOG_SOURCE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="事件" htmlFor="logs-type">
          <select id="logs-type" name="type" defaultValue={query.type} className="adm-input">
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
        </FormField>

        <FormField label="用户 ID" htmlFor="logs-user-id">
          <input
            id="logs-user-id"
            name="userId"
            defaultValue={query.userId}
            type="number"
            className="adm-input"
          />
        </FormField>

        <FormField label="IP" htmlFor="logs-ip">
          <input
            id="logs-ip"
            name="ip"
            defaultValue={query.ip}
            className="adm-input"
          />
        </FormField>

        <FormField label="从" htmlFor="logs-from">
          <input
            id="logs-from"
            name="from"
            defaultValue={query.from}
            type="date"
            className="adm-input"
          />
        </FormField>

        <FormField label="至" htmlFor="logs-to">
          <input
            id="logs-to"
            name="to"
            defaultValue={query.to}
            type="date"
            className="adm-input"
          />
        </FormField>

        <div className="flex gap-2 sm:col-span-2 md:col-span-4 xl:col-span-6">
          <AdminButton
            type="submit"
            variant="primary"
            icon={<Filter className="h-3.5 w-3.5" />}
          >
            筛选
          </AdminButton>
          <AdminButton variant="secondary" onClick={reset}>
            重置
          </AdminButton>
        </div>
      </form>
    </Toolbar>
  );
}
