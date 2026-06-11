import { notFound } from 'next/navigation';
import { getChar } from '@/lib/rare-chars';
import { RareCharDetail } from '@/components/rare/RareCharDetail';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function RareCharDetailPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getChar(decoded);
  if (!data) notFound();
  return (
    <div className="p-4">
      <RareCharDetail data={data} />
    </div>
  );
}
