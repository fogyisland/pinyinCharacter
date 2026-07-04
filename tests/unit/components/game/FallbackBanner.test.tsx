// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { beforeEach, it, expect } from 'vitest';

beforeEach(() => cleanup());

it('renders the fallback message when unavailable', async () => {
  const { FallbackBanner } = await import('@/components/game/FallbackBanner');
  const { getByRole } = render(<FallbackBanner hskLevel={5} available={false} />);
  expect(getByRole('status').textContent).toContain('HSK 5');
  expect(getByRole('status').textContent).toContain('HSK 4');
});

it('renders nothing when available', async () => {
  const { FallbackBanner } = await import('@/components/game/FallbackBanner');
  const { container } = render(<FallbackBanner hskLevel={5} available={true} />);
  expect(container.firstChild).toBeNull();
});