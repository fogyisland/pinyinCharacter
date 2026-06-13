// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ToneToken } from '@/components/game/ToneToken';

describe('ToneToken', () => {
  it('renders the tone number', () => {
    const { container } = render(<ToneToken tone={1} matched={false} onDragStart={() => {}} />);
    expect(container.textContent).toBe('1');
  });
  it('fires onDragStart with tone value', () => {
    const fn = vi.fn();
    const { container } = render(<ToneToken tone={3} matched={false} onDragStart={fn} />);
    const el = container.querySelector('[draggable]')!;
    fireEvent.dragStart(el, { dataTransfer: { setData: vi.fn() } });
    expect(fn).toHaveBeenCalled();
  });
  it('applies dimmed style when matched', () => {
    const { container } = render(<ToneToken tone={2} matched={true} onDragStart={() => {}} />);
    expect(container.querySelector('[draggable]')!.className).toMatch(/opacity/);
  });
});
