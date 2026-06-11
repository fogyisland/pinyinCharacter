import { Suspense } from 'react';
import { WorksheetGenerator } from '@/components/worksheet/WorksheetGenerator';

export const dynamic = 'force-dynamic';

export default function WorksheetPage() {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">字帖生成器</h1>
      <Suspense fallback={<div>加载中...</div>}>
        <WorksheetGenerator />
      </Suspense>
    </div>
  );
}
