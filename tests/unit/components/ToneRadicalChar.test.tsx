// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ToneRadicalChar } from '@/components/game/ToneRadicalChar';

describe('ToneRadicalChar', () => {
  it('renders the char with pinyin and empty slots', () => {
    const { container } = render(
      <ToneRadicalChar char="妈" pinyin="mā" matchedTone={null} matchedRadical={null} onDrop={() => {}} />,
    );
    expect(container.textContent).toContain('妈');
    expect(container.textContent).toContain('mā');
  });
  it('shows matched values in slots', () => {
    const { container } = render(
      <ToneRadicalChar char="妈" pinyin="mā" matchedTone={1} matchedRadical="女" onDrop={() => {}} />,
    );
    expect(container.textContent).toContain('1');
    expect(container.textContent).toContain('女');
  });
  it('calls onDrop with slot kind and payload', () => {
    const fn = vi.fn();
    const { container } = render(
      <ToneRadicalChar char="妈" pinyin="mā" matchedTone={null} matchedRadical={null} onDrop={fn} />,
    );
    const toneSlot = container.querySelectorAll('[data-slot]')[0]!;
    fireEvent.drop(toneSlot, { dataTransfer: { getData: () => '1' } });
    expect(fn).toHaveBeenCalledWith('tone', '1');
  });
});
