import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getWorksheet } from '@/lib/worksheet';
import { WorksheetPreview } from '@/components/worksheet/WorksheetPreview';
import { DeleteWorksheetButton } from '@/components/worksheet/DeleteWorksheetButton';
import { PrintButton } from './PrintButton';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WorksheetDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/?auth=login&next=/worksheet/${id}`);
  const wid = Number(id);
  if (!Number.isInteger(wid)) notFound();
  const ws = await getWorksheet(wid);
  if (!ws) notFound();
  if (ws.userId !== user.id) notFound();
  return (
    <div className="p-4">
      <div className="worksheet-no-print mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{ws.title}</h1>
        <div className="flex gap-2">
          <PrintButton />
          <DeleteWorksheetButton id={ws.id} />
        </div>
      </div>
      <p className="worksheet-no-print mb-4 text-sm text-gray-500">
        {ws.content.length} 字 · {ws.cellStyle === 'brush' ? '毛笔格' : '田字格'} ·{' '}
        {new Date(ws.createdAt).toLocaleString()}
      </p>
      <WorksheetPreview title={undefined} content={ws.content} cellStyle={ws.cellStyle} showHeader={false} />
    </div>
  );
}
