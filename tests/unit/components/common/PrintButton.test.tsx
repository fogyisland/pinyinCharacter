// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrintButton } from '@/components/common/PrintButton';

describe('PrintButton', () => {
  beforeEach(() => {
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { id: 1 } }) });
    (global as any).window.print = vi.fn();
  });

  it('calls the endpoint and window.print on click', async () => {
    render(<PrintButton endpoint="/api/poetry/1/print" label="打印" />);
    fireEvent.click(screen.getByText('打印'));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/poetry/1/print', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });
});
