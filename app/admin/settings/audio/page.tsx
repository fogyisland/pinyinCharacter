import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { listTracks } from '@/lib/audio-tracks';
import { AudioTracksForm } from '@/components/admin/AudioTracksForm';

export const dynamic = 'force-dynamic';

export default async function AudioSettingsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) redirect('/login');
  const tracks = await listTracks();
  return (
    <div className="card-paper rounded-lg p-6">
      <h1 className="text-lg font-semibold text-ink mb-1">佛经音频</h1>
      <p className="text-sm text-ink-soft mb-6">
        上传 MP3 文件,设置「抄经」页右下角播放器使用的默认曲目。同一时间仅一首为默认。
      </p>
      <AudioTracksForm initialTracks={tracks} />
    </div>
  );
}
