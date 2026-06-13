// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RadicalToken } from '@/components/game/RadicalToken';

describe('RadicalToken', () => {
  it('renders the radical char', () => {
    const { container } = render(<RadicalToken radical="氵" matched={false} onDragStart={() => {}} />);
    expect(container.textContent).toBe('氵');
  });
  it('fires onDragStart with radical value', () => {
    const fn = vi.fn();
    const { container } = render(<RadicalToken radical="艹" matched={false} onDragStart={fn} />);
    fireEvent.dragStart(container.querySelector('[draggable]')!, { dataTransfer: { setData: vi.fn() } });
    expect(fn).toHaveBeenCalledWith('艹');
  });
});
