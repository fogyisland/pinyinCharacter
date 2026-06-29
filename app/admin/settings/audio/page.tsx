import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { listTracks } from '@/lib/audio-tracks';
import { listPlaylists } from '@/lib/playlists';
import { AudioTracksForm } from '@/components/admin/AudioTracksForm';
import { PlaylistsPanel } from '@/components/admin/PlaylistsPanel';

export const dynamic = 'force-dynamic';

export default async function AudioSettingsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) redirect('/login');
  const [tracks, playlists] = await Promise.all([listTracks(), listPlaylists()]);
  return (
    <div className="space-y-10">
      <section className="card-paper rounded-lg p-6">
        <h1 className="text-lg font-semibold text-ink mb-1">佛经音频曲目</h1>
        <p className="text-sm text-ink-soft mb-6">
          上传 MP3 文件,作为播放列表的素材库。同一时间仅一个播放列表为默认。
        </p>
        <AudioTracksForm initialTracks={tracks} />
      </section>
      <section className="card-paper rounded-lg p-6">
        <h2 className="text-lg font-semibold text-ink mb-1">播放列表</h2>
        <p className="text-sm text-ink-soft mb-6">
          创建有序的播放列表,「抄经」页右下角播放器会按顺序播放默认列表中的曲目。
        </p>
        <PlaylistsPanel initialPlaylists={playlists} tracks={tracks} />
      </section>
    </div>
  );
}