// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SutraAudioPlayer } from '@/components/sutra/SutraAudioPlayer';

function getAudio(): HTMLAudioElement {
  const el = document.querySelector('audio');
  if (!el) throw new Error('audio element not found');
  return el as HTMLAudioElement;
}

const singleTrack = [{ id: 1, title: '大悲咒', src: '/audio/1.mp3', position: 1 }];
const playlist = [
  { id: 1, title: '大悲咒', src: '/audio/1.mp3', position: 1 },
  { id: 2, title: '心经',   src: '/audio/2.mp3', position: 2 },
  { id: 3, title: '药师咒', src: '/audio/3.mp3', position: 3 },
];

describe('SutraAudioPlayer', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders minimized by default with the expand button', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    expect(screen.getByRole('button', { name: '展开播放器' })).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeInTheDocument();
  });

  it('passes the first track src to the audio element', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    expect(getAudio().getAttribute('src')).toBe('/audio/1.mp3');
  });

  it('expands on click of the minimized button and shows the track title', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByText('大悲咒')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化播放器' })).toBeInTheDocument();
  });

  it('collapses back to minimized when minimize button is clicked', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    fireEvent.click(screen.getByRole('button', { name: '最小化播放器' }));
    expect(screen.getByRole('button', { name: '展开播放器' })).toBeInTheDocument();
  });

  it('calls audio.play() when play button is clicked', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const audio = getAudio();
    const playSpy = vi.spyOn(audio, 'play').mockResolvedValue();
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(playSpy).toHaveBeenCalled();
  });

  it('cycles loop mode list → none → single → list', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const loopBtn = screen.getByRole('button', { name: /循环模式/ });
    expect(loopBtn).toHaveTextContent('列表循环');
    fireEvent.click(loopBtn);
    expect(loopBtn).toHaveTextContent('不循环');
    fireEvent.click(loopBtn);
    expect(loopBtn).toHaveTextContent('单曲循环');
    fireEvent.click(loopBtn);
    expect(loopBtn).toHaveTextContent('列表循环');
  });

  it('sets audio.loop=true only when loop mode is single with a single track', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    const audio = getAudio();
    // default loopMode is 'list', tracks.length===1 → audio.loop=false (we advance via setTrackIndex)
    expect(audio.loop).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const loopBtn = screen.getByRole('button', { name: /循环模式/ });
    // list → none: still false
    fireEvent.click(loopBtn);
    expect(audio.loop).toBe(false);
    // none → single: becomes true
    fireEvent.click(loopBtn);
    expect(audio.loop).toBe(true);
    // single → list: back to false
    fireEvent.click(loopBtn);
    expect(audio.loop).toBe(false);
  });

  it('updates audio.volume when the volume slider changes', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const volume = screen.getByRole('slider', { name: '音量' });
    fireEvent.change(volume, { target: { value: '0.3' } });
    expect(getAudio().volume).toBeCloseTo(0.3);
  });

  it('updates audio.currentTime when the seek slider changes', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    const audio = getAudio();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 100 });
    audio.dispatchEvent(new Event('loadedmetadata'));
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const seek = screen.getByRole('slider', { name: '播放进度' });
    fireEvent.change(seek, { target: { value: '42.5' } });
    expect(audio.currentTime).toBeCloseTo(42.5);
  });

  it('displays duration after loadedmetadata fires', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    const audio = getAudio();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 125 });
    audio.dispatchEvent(new Event('loadedmetadata'));
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('advances to next track when ended fires in list mode (multi-track)', () => {
    render(<SutraAudioPlayer tracks={playlist} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const audio = getAudio();
    vi.spyOn(audio, 'play').mockResolvedValue();
    act(() => {
      audio.dispatchEvent(new Event('ended'));
    });
    // After advancing, src should change to next track
    expect(getAudio().getAttribute('src')).toBe('/audio/2.mp3');
  });

  it('wraps to first track after last track ends in list mode', () => {
    render(<SutraAudioPlayer tracks={playlist} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const audio = getAudio();
    vi.spyOn(audio, 'play').mockResolvedValue();
    // Jump to last track via next button (0 → 1 → 2)
    fireEvent.click(screen.getByRole('button', { name: '下一曲' }));
    fireEvent.click(screen.getByRole('button', { name: '下一曲' }));
    expect(getAudio().getAttribute('src')).toBe('/audio/3.mp3');
    act(() => {
      audio.dispatchEvent(new Event('ended'));
    });
    expect(getAudio().getAttribute('src')).toBe('/audio/1.mp3');
  });

  it('renders prev/next buttons only for multi-track playlists', () => {
    const { unmount } = render(<SutraAudioPlayer tracks={singleTrack} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.queryByRole('button', { name: '上一曲' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一曲' })).toBeNull();
    unmount();
    render(<SutraAudioPlayer tracks={playlist} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByRole('button', { name: '上一曲' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一曲' })).toBeInTheDocument();
  });

  it('shows track position indicator 1/3 for multi-track', () => {
    render(<SutraAudioPlayer tracks={playlist} playlistTitle="早课" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByText('1/3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一曲' }));
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('shows playlist title above the current track for multi-track', () => {
    render(<SutraAudioPlayer tracks={playlist} playlistTitle="早课" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByText('早课')).toBeInTheDocument();
    expect(screen.getByText('大悲咒')).toBeInTheDocument();
  });

  it('prev button wraps from first to last track', () => {
    render(<SutraAudioPlayer tracks={playlist} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    vi.spyOn(getAudio(), 'play').mockResolvedValue();
    expect(getAudio().getAttribute('src')).toBe('/audio/1.mp3');
    fireEvent.click(screen.getByRole('button', { name: '上一曲' }));
    expect(getAudio().getAttribute('src')).toBe('/audio/3.mp3');
  });

  it('does not auto-restart when audio ends in single mode (native loop handles it)', () => {
    render(<SutraAudioPlayer tracks={singleTrack} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const audio = getAudio();
    const playSpy = vi.spyOn(audio, 'play').mockResolvedValue();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
    audio.dispatchEvent(new Event('ended'));
    expect(playSpy).not.toHaveBeenCalled();
  });
});