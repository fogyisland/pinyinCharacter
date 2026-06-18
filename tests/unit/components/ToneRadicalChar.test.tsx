// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ToneRadicalChar } from '@/components/game/ToneRadicalChar';

describe('ToneRadicalChar', () => {
  it('renders the char with pinyin and empty slot in tone mode', () => {
    const { container } = render(
      <ToneRadicalChar char="妈" pinyin="mā" slotKind="tone" matched={null} onDrop={() => {}} />,
    );
    expect(container.textContent).toContain('妈');
    expect(container.textContent).toContain('mā');
  });
  it('shows matched value in slot', () => {
    const { container } = render(
      <ToneRadicalChar char="妈" pinyin="mā" slotKind="tone" matched="1" onDrop={() => {}} />,
    );
    expect(container.textContent).toContain('1');
  });
  it('hides pinyin above char in pinyin mode (slot holds the pinyin)', () => {
    const { container } = render(
      <ToneRadicalChar char="妈" pinyin="mā" slotKind="pinyin" matched={null} onDrop={() => {}} />,
    );
    expect(container.textContent).toContain('妈');
    // pinyin is only inside the slot, not above; slot is empty so 'mā' not shown
    expect(container.textContent).not.toContain('mā');
  });
  it('calls onDrop with slot kind and payload', () => {
    const fn = vi.fn();
    const { container } = render(
      <ToneRadicalChar char="妈" pinyin="mā" slotKind="radical" matched={null} onDrop={fn} />,
    );
    const slot = container.querySelectorAll('[data-slot]')[0]!;
    fireEvent.drop(slot, { dataTransfer: { getData: () => '女' } });
    expect(fn).toHaveBeenCalledWith('radical', '女');
  });
});
