'use client';

import { useRouter } from 'next/navigation';
import { Filter } from 'lucide-react';
import {
  DOWNLOAD_SOURCE_OPTIONS,
  buildDownloadsHref,
  parseDownloadSourceType,
  type DownloadsQuery,
} from '@/lib/admin-downloads-url';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';

/** Read a form field as a trimmed string. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The /admin/downloads filter bar.
 *
 * A small client island: the page itself renders on the server, and this
 * island only turns the form into a query string and navigates to it.
 *
 * The bar sits inside the page's `Toolbar`, so it only lays its fields out
 * — the bar's own frame belongs to the toolbar.
 */
export function DownloadsFilterBar({ query }: { query: DownloadsQuery }) {
  const router = useRouter();

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    router.push(
      buildDownloadsHref(query, {
        sourceType: parseDownloadSourceType(field(form, 'sourceType')),
        userId: field(form, 'userId'),
        from: field(form, 'from'),
        to: field(form, 'to'),
        page: 1,
      }),
    );
  }

  function reset() {
    router.push('/admin/downloads');
  }

  return (
    <form onSubmit={apply} className="grid w-full grid-cols-1 md:grid-cols-5 gap-2 items-end">
      <FormField label="来源类型" htmlFor="downloads-source-type">
        <select
          id="downloads-source-type"
          name="sourceType"
          defaultValue={query.sourceType}
          className="adm-input"
        >
          {DOWNLOAD_SOURCE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="用户 ID" htmlFor="downloads-user-id">
        <input
          id="downloads-user-id"
          name="userId"
          defaultValue={query.userId}
          type="text"
          placeholder="数字 ID"
          className="adm-input"
        />
      </FormField>
      <FormField label="从" htmlFor="downloads-from">
        <input
          id="downloads-from"
          name="from"
          defaultValue={query.from}
          type="date"
          className="adm-input"
        />
      </FormField>
      <FormField label="至" htmlFor="downloads-to">
        <input
          id="downloads-to"
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
