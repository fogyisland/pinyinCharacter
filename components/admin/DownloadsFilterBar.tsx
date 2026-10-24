'use client';

import { useRouter } from 'next/navigation';
import { Filter } from 'lucide-react';
import {
  DOWNLOAD_SOURCE_OPTIONS,
  buildDownloadsHref,
  parseDownloadSourceType,
  type DownloadsQuery,
} from '@/lib/admin-downloads-url';

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
    <form
      onSubmit={apply}
      className="card-paper rounded-lg p-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end"
    >
      <div>
        <label className="text-xs text-ink-soft" htmlFor="downloads-source-type">
          来源类型
        </label>
        <select
          id="downloads-source-type"
          name="sourceType"
          defaultValue={query.sourceType}
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        >
          {DOWNLOAD_SOURCE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-ink-soft" htmlFor="downloads-user-id">
          用户 ID
        </label>
        <input
          id="downloads-user-id"
          name="userId"
          defaultValue={query.userId}
          type="text"
          placeholder="数字 ID"
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        />
      </div>
      <div>
        <label className="text-xs text-ink-soft" htmlFor="downloads-from">
          从
        </label>
        <input
          id="downloads-from"
          name="from"
          defaultValue={query.from}
          type="date"
          className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
        />
      </div>
      <div>
        <label className="text-xs text-ink-soft" htmlFor="downloads-to">
          至
        </label>
        <input
          id="downloads-to"
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
