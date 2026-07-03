// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ChainPickerModal } from '@/components/game/ChainPickerModal';
import type { CharInfo } from '@/lib/chain-types';

const ci = (char: string, pinyin: string): CharInfo => ({
  char, pinyin, meaning: '', radical: '阝', tone: 1,
});

beforeEach(() => {
  cleanup();
});

describe('ChainPickerModal', () => {
  it('renders all valid chars', () => {
    const chars = [ci('那', 'nà'), ci('呢', 'ne'), ci('难', 'nán')];
    render(<ChainPickerModal validChars={chars} onSelect={() => {}} />);
    expect(screen.getByText('那')).toBeTruthy();
    expect(screen.getByText('呢')).toBeTruthy();
    expect(screen.getByText('难')).toBeTruthy();
    expect(screen.getByText('nà')).toBeTruthy();
  });

  it('shows count of valid chars', () => {
    const chars = [ci('那', 'nà'), ci('呢', 'ne')];
    render(<ChainPickerModal validChars={chars} onSelect={() => {}} />);
    expect(screen.getByText(/可选字 \(2\)/)).toBeTruthy();
  });

  it('calls onSelect when char is clicked', () => {
    const onSelect = vi.fn();
    const chars = [ci('那', 'nà'), ci('呢', 'ne')];
    render(<ChainPickerModal validChars={chars} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('那'));
    expect(onSelect).toHaveBeenCalledWith('那');
  });

  it('renders nothing for empty list', () => {
    const { container } = render(<ChainPickerModal validChars={[]} onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('displays radical', () => {
    const chars = [ci('那', 'nà')];
    render(<ChainPickerModal validChars={chars} onSelect={() => {}} />);
    expect(screen.getByText('阝')).toBeTruthy();
  });
});
