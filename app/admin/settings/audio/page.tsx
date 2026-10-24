import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { listTracks } from '@/lib/audio-tracks';
import { listPlaylists } from '@/lib/playlists';
import { AudioTracksForm } from '@/components/admin/AudioTracksForm';
import { PlaylistsPanel } from '@/components/admin/PlaylistsPanel';
import { TtsCacheCard } from './TtsCacheCard';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';

export const dynamic = 'force-dynamic';

export default async function AudioSettingsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) redirect('/login');
  const [tracks, playlists] = await Promise.all([listTracks(), listPlaylists()]);
  return (
    <div>
      <PageHeader
        title="音频"
        description="管理佛经音频曲目、播放列表与 TTS 缓存。默认播放列表会在「抄经」页右下角播放器按顺序播放。"
      />
      <div className="space-y-4">
        {/* The two form components bring their own panels — wrapping them in
            another one would stack a card inside a card. */}
        <AudioTracksForm initialTracks={tracks} />
        <PlaylistsPanel initialPlaylists={playlists} tracks={tracks} />
        <Panel title="TTS 音频缓存" description="客户端缓存 (Cache API · tts-v1) 的统计与清理。">
          <TtsCacheCard />
        </Panel>
      </div>
    </div>
  );
}
