// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { SutraCopyView } from '@/components/sutra/SutraCopyView';
import type { SutraChunk } from '@/lib/sutra-types';

const CHUNK: SutraChunk = {
  id: 0,
  label: '心经',
  content: ['观自在菩萨', '行深般若波罗蜜多时'],
  pinyin: [['guān'], ['xíng']],
};

function getWrittenChars(row: HTMLElement): boolean[] {
  const spans = Array.from(row.querySelectorAll<HTMLElement>('span[data-idx]'));
  return spans.map(s => s.classList.contains('copy-char--written'));
}

beforeEach(() => {
  fetchMock.mockReset();
  // Default GET: fresh user, no progress
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data: { progress: null } }),
  });
});

describe('SutraCopyView', () => {
  it('renders all chars unwritten by default (logged-in user)', async () => {
    render(<SutraCopyView chunk={CHUNK} sutraId={1} userId={42} reading="horizontal" onExit={() => {}} />);
    // Wait for the GET to resolve
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const written = getWrittenChars(screen.getByTestId('copy-body'));
    expect(written).toEqual([false, false, false, false, false, false, false, false, false, false, false, false, false, false]);
  });

  it('hydrates from GET response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: { progress: { writtenChars: [true, true, false, false, false, false, false, false, false, false, false, false, false, false], startedAt: new Date(), updatedAt: new Date(), completedAt: null } } }),
    });
    render(<SutraCopyView chunk={CHUNK} sutraId={1} userId={42} reading="horizontal" onExit={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const written = getWrittenChars(screen.getByTestId('copy-body'));
    expect(written).toEqual([true, true, false, false, false, false, false, false, false, false, false, false, false, false]);
  });

  it('clicking a char marks it written and triggers POST (after 500ms debounce)', async () => {
    render(<SutraCopyView chunk={CHUNK} sutraId={1} userId={42} reading="horizontal" onExit={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    // Click the first char
    const spans = screen.getByTestId('copy-body').querySelectorAll<HTMLElement>('span[data-idx]');
    await act(async () => { fireEvent.click(spans[0]!); });
    expect(spans[0]!.classList.contains('copy-char--written')).toBe(true);

    // Wait debounce 500ms
    await act(async () => { await new Promise(r => setTimeout(r, 550)); });

    // The POST call should be the 2nd fetch (1st was the GET)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe('/api/sutra/1/copy-progress');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ chunkIdx: 0, writtenChars: [true, false, false, false, false, false, false, false, false, false, false, false, false, false] });
  });

  it('anonymous user sees disabled view + banner', async () => {
    render(<SutraCopyView chunk={CHUNK} sutraId={1} userId={null} reading="horizontal" onExit={() => {}} />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(screen.getByText(/请登录后开始抄经/)).toBeInTheDocument();
    const spans = screen.getByTestId('copy-body').querySelectorAll<HTMLElement>('span[data-idx]');
    expect(spans[0]!.classList.contains('copy-char--disabled')).toBe(true);
    // Click is a no-op
    await act(async () => { fireEvent.click(spans[0]!); });
    expect(spans[0]!.classList.contains('copy-char--written')).toBe(false);
  });

  it('last char click triggers collapse + seal phase', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: { progress: { writtenChars: new Array(14).fill(true), startedAt: new Date(), updatedAt: new Date(), completedAt: null } } }),
    });
    render(<SutraCopyView chunk={CHUNK} sutraId={1} userId={42} reading="horizontal" onExit={() => {}} />);
    // flush initial GET microtask
    await act(async () => { await vi.runAllTimersAsync(); });
    // Find the body — should already be in collapsing phase
    const body = screen.getByTestId('copy-view');
    expect(body.classList.contains('copy-view--collapsing')).toBe(true);
    // Advance 1200ms to sealed phase
    await act(async () => { vi.advanceTimersByTime(1200); });
    // Seal text appears (CopySeal has aria-label="功德圆满")
    expect(screen.getByLabelText('功德圆满')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
