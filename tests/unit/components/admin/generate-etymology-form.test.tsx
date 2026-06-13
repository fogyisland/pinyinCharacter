// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GenerateEtymologyForm } from '@/components/admin/GenerateEtymologyForm';

const mockFetch = vi.fn();
(global as any).fetch = mockFetch;

describe('GenerateEtymologyForm', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    cleanup();
  });

  it('renders textarea + submit button', () => {
    render(<GenerateEtymologyForm />);
    expect(screen.getByPlaceholderText(/汉字/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /生成/ })).toBeInTheDocument();
  });

  it('submits chars to /api/admin/chars/generate', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: { generated: 2, skipped: 0, errors: [] } }),
    });
    render(<GenerateEtymologyForm />);
    fireEvent.change(screen.getByPlaceholderText(/汉字/), { target: { value: '一丁' } });
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    expect(mockFetch).toHaveBeenCalledWith('/api/admin/chars/generate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ chars: ['一', '丁'] }),
    }));
  });
});
