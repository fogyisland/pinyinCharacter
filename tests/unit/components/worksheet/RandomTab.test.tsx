// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RandomTab } from '@/components/worksheet/RandomTab';

describe('RandomTab', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { chars: [{ char: '你' }, { char: '好' }] } }),
    }) as any;
  });

  it('calls onPicked with chars from API', async () => {
    const onPicked = vi.fn();
    render(<RandomTab onPicked={onPicked} />);
    fireEvent.click(screen.getByText('随机生成'));
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith(['你', '好']));
  });

  it('clamps count to 1-100', async () => {
    render(<RandomTab onPicked={vi.fn()} />);
    const input = screen.getByDisplayValue('20') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '999' } });
    expect(input.value).toBe('100');
  });
});
