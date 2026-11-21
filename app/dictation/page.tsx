'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DictationItem } from '@/lib/dictation';
import { DictationPrep } from '@/components/dictation/DictationPrep';

/**
 * The dictation tool page: choose items, print the paper.
 *
 * The tabs (出卷 / 报听写) arrive with the runner in the next task; this
 * page already owns the item draft so the runner can share it.
 */
export default function DictationPage() {
  const [items, setItems] = useState<DictationItem[]>([]);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // The tab lives in the URL (?tab=runner), like the game page's panels,
  // so a teacher can bookmark the runner.
  const tab = params?.get('tab') === 'runner' ? 'runner' : 'prep';
  useEffect(() => {
    if (tab === 'prep') return;
    // The runner is wired in the next task; until then a stray ?tab=runner
    // falls back to the form rather than showing an empty page.
    router.replace(pathname ?? '/dictation');
  }, [tab, router, pathname]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="worksheet-no-print mb-4">
        <h1 className="text-xl font-bold">听写练习</h1>
        <p className="mt-1 text-sm text-ink-soft">
          选词条 → 生成听写卷与答案页 → 打印上课。答题卷留空给学生写，答案页带浅灰范字。
        </p>
      </div>
      <DictationPrep items={items} onChange={setItems} />
    </main>
  );
}
