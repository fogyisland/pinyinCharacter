// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SutraAudioPlayer } from '@/components/sutra/SutraAudioPlayer';

function getAudio(): HTMLAudioElement {
  const el = document.querySelector('audio');
  if (!el) throw new Error('audio element not found');
  return el as HTMLAudioElement;
}

describe('SutraAudioPlayer', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders minimized by default with the expand button', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" />);
    expect(screen.getByRole('button', { name: '展开播放器' })).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeInTheDocument();
  });

  it('passes src to the audio element', () => {
    render(<SutraAudioPlayer src="/audio/xinjing.mp3" title="心经" />);
    expect(getAudio().getAttribute('src')).toBe('/audio/xinjing.mp3');
  });

  it('expands on click of the minimized button and shows the title', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" title="心经" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByText('心经')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化播放器' })).toBeInTheDocument();
  });

  it('collapses back to minimized when minimize button is clicked', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    fireEvent.click(screen.getByRole('button', { name: '最小化播放器' }));
    expect(screen.getByRole('button', { name: '展开播放器' })).toBeInTheDocument();
  });

  it('calls audio.play() when play button is clicked', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const audio = getAudio();
    const playSpy = vi.spyOn(audio, 'play').mockResolvedValue();
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(playSpy).toHaveBeenCalled();
  });

  it('cycles loop mode single → list → none → single', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const loopBtn = screen.getByRole('button', { name: /循环模式/ });
    expect(loopBtn).toHaveTextContent('单曲循环');
    fireEvent.click(loopBtn);
    expect(loopBtn).toHaveTextContent('列表循环');
    fireEvent.click(loopBtn);
    expect(loopBtn).toHaveTextContent('不循环');
    fireEvent.click(loopBtn);
    expect(loopBtn).toHaveTextContent('单曲循环');
  });

  it('sets audio.loop=true when loop mode is single and false otherwise', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" />);
    const audio = getAudio();
    expect(audio.loop).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const loopBtn = screen.getByRole('button', { name: /循环模式/ });
    fireEvent.click(loopBtn);
    expect(audio.loop).toBe(false);
    fireEvent.click(loopBtn);
    expect(audio.loop).toBe(false);
    fireEvent.click(loopBtn);
    expect(audio.loop).toBe(true);
  });

  it('updates audio.volume when the volume slider changes', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const volume = screen.getByRole('slider', { name: '音量' });
    fireEvent.change(volume, { target: { value: '0.3' } });
    expect(getAudio().volume).toBeCloseTo(0.3);
  });

  it('updates audio.currentTime when the seek slider changes', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" />);
    const audio = getAudio();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 100 });
    audio.dispatchEvent(new Event('loadedmetadata'));
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const seek = screen.getByRole('slider', { name: '播放进度' });
    fireEvent.change(seek, { target: { value: '42.5' } });
    expect(audio.currentTime).toBeCloseTo(42.5);
  });

  it('displays duration after loadedmetadata fires', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" />);
    const audio = getAudio();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 125 });
    audio.dispatchEvent(new Event('loadedmetadata'));
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('restarts playback when audio ends in list mode', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const loopBtn = screen.getByRole('button', { name: /循环模式/ });
    fireEvent.click(loopBtn);
    const audio = getAudio();
    const playSpy = vi.spyOn(audio, 'play').mockResolvedValue();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
    audio.dispatchEvent(new Event('ended'));
    expect(playSpy).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
  });

  it('does not auto-restart when audio ends in single mode (native loop handles it)', () => {
    render(<SutraAudioPlayer src="/audio/dabei.mp3" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const audio = getAudio();
    const playSpy = vi.spyOn(audio, 'play').mockResolvedValue();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
    audio.dispatchEvent(new Event('ended'));
    expect(playSpy).not.toHaveBeenCalled();
  });
});