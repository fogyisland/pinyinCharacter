// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

global.fetch = vi.fn();

import { FontConfigForm } from '@/components/admin/FontConfigForm';
import { ERA_FONTS, DEFAULT_ERA_FONTS } from '@/lib/era-fonts';

const initial = DEFAULT_ERA_FONTS;

describe('FontConfigForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true, updated: ['era.jiaguwen.font'] }) });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders 5 selects — one per era', () => {
    render(<FontConfigForm initial={initial} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(5);
  });

  it('renders each select with the current font preselected', () => {
    render(<FontConfigForm initial={{ ...initial, jiaguwen: 'OracularInverted' }} />);
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    // The first era select is jiaguwen
    expect(selects[0].value).toBe('OracularInverted');
  });

  it('renders all curated font options in the jiaguwen dropdown', () => {
    render(<FontConfigForm initial={initial} />);
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const jiaguwenOptions = Array.from(selects[0].options).map((o) => o.value);
    expect(jiaguwenOptions).toEqual(ERA_FONTS.jiaguwen.map((o) => o.id));
  });

  it('save button calls fetch with PUT + body of changed eras only', async () => {
    render(<FontConfigForm initial={initial} />);
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(selects[0], { target: { value: 'OracularInverted' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/font-config',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ jiaguwen: 'OracularInverted' }),
        }),
      );
    });
  });

  it('shows an error message when PUT returns non-ok', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid font id for kaishu' }) });
    render(<FontConfigForm initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(await screen.findByText(/invalid font id/)).toBeInTheDocument();
  });
});