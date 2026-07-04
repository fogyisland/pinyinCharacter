// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ChainSummary } from '@/components/game/ChainSummary';
import type { CharInfo } from '@/lib/chain-types';

const mockPushToast = vi.fn();
vi.mock('@/lib/toast-store', () => ({
  useToastStore: (sel: any) => sel({ push: mockPushToast }),
}));

const ci = (char: string, pinyin: string): CharInfo => ({
  char, pinyin, meaning: '', radical: '阝', tone: 1,
});

beforeEach(() => {
  cleanup();
  mockPushToast.mockClear();
});

describe('ChainSummary', () => {
  it('shows the chain length', () => {
    render(<ChainSummary chain={['安', '那']} charsList={[]} onRestart={() => {}} />);
    expect(screen.getByText(/接龙长度/)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows the joined chain text', () => {
    render(<ChainSummary chain={['安', '那', '呢']} charsList={[]} onRestart={() => {}} />);
    expect(screen.getByText('安 → 那 → 呢')).toBeTruthy();
  });

  it('renders a 读音 button per character', () => {
    render(<ChainSummary chain={['安', '那']} charsList={[]} onRestart={() => {}} />);
    // Two 读音 buttons (one per char) + one 朗读全部
    expect(screen.getAllByText('读音')).toHaveLength(2);
  });

  it('renders a 朗读全部 button (one per chain, not per char)', () => {
    render(<ChainSummary chain={['安', '那', '呢']} charsList={[]} onRestart={() => {}} />);
    expect(screen.getByText('朗读全部')).toBeTruthy();
  });

  it('looks up and shows pinyin per char from charsList', () => {
    render(
      <ChainSummary
        chain={['安', '那']}
        charsList={[ci('安', 'ān'), ci('那', 'nà')]}
        onRestart={() => {}}
      />,
    );
    expect(screen.getByText('ān')).toBeTruthy();
    expect(screen.getByText('nà')).toBeTruthy();
  });

  it('omits pinyin label when char not in charsList', () => {
    render(
      <ChainSummary
        chain={['安', '那']}
        charsList={[ci('安', 'ān')]}
        onRestart={() => {}}
      />,
    );
    // 安 has pinyin; 那 has no entry → no second pinyin text
    expect(screen.getByText('ān')).toBeTruthy();
    expect(screen.queryByText('nà')).toBeNull();
  });

  it('calls onRestart when 再来一局 clicked', () => {
    const onRestart = vi.fn();
    render(<ChainSummary chain={['安']} charsList={[]} onRestart={onRestart} />);
    fireEvent.click(screen.getByText('再来一局'));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it('copies chain text to clipboard on 分享 and pushes success toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<ChainSummary chain={['安', '那']} charsList={[]} onRestart={() => {}} />);
    fireEvent.click(screen.getByText('分享'));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('安 → 那');
    });
    expect(mockPushToast).toHaveBeenCalledWith('success', '已复制到剪贴板');
  });
});
