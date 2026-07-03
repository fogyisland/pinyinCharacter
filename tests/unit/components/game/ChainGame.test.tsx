// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { CharInfo } from '@/lib/chain-types';

const ci = (char: string, pinyin: string): CharInfo => ({
  char, pinyin, meaning: '', radical: '宀', tone: 1,
});

const sampleChars: CharInfo[] = [
  ci('安', 'ān'),
  ci('那', 'nà'),
  ci('呢', 'ne'),
  ci('爱', 'ài'),
  ci('一', 'yī'),
];

describe('ChainGame', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    // Make pickStarter deterministic: always pick index 0 ('安 ān', has 2 validNext)
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  it('shows loading state initially', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    // Dynamic import so vi.resetModules() clears the api-chain module cache too
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it('transitions to playing with starter after fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    expect(screen.getByText(/接龙长度/)).toBeTruthy();
  });

  it('shows valid next chars in modal after loading', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    await waitFor(() => {
      expect(screen.getByText(/可选字/)).toBeTruthy();
    });
  });

  it('grows chain when char is picked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    await waitFor(() => screen.getByText(/可选字/));
    fireEvent.click(screen.getByText('那'));
    await waitFor(() => {
      expect(screen.getByText(/接龙长度: 2/)).toBeTruthy();
    });
  });

  it('shows 换一条 button disabled when chain length is 1', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    await waitFor(() => screen.getByText(/可选字/));
    const swapBtn = screen.getByText('换一条') as HTMLButtonElement;
    expect(swapBtn.disabled).toBe(true);
  });

  it('shortens chain when 换一条 is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    await waitFor(() => screen.getByText(/可选字/));
    fireEvent.click(screen.getByText('那'));
    await waitFor(() => screen.getByText(/接龙长度: 2/));
    const swapBtn = screen.getByText('换一条') as HTMLButtonElement;
    expect(swapBtn.disabled).toBe(false);
    fireEvent.click(swapBtn);
    await waitFor(() => {
      expect(screen.getByText(/接龙长度: 1/)).toBeTruthy();
    });
  });

  it('triggers finished state when validNext is empty (dead letter)', async () => {
    // Build chars where starter has 0 valid next chars
    const deadChars: CharInfo[] = [
      ci('包', 'bāo'),  // ends in o, no char starts with o
    ];
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => deadChars,
    } as Response);
    // Dynamic import so vi.resetModules() clears the api-chain module cache too
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    // pickStarter will retry 5 times then fallback to 包
    // 包 has 0 validNext → finished
    await waitFor(() => {
      expect(screen.getByText(/接龙结束/)).toBeTruthy();
    });
  });
});
