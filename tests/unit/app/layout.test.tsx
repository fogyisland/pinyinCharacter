// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RootLayout from '@/app/layout';

// React 19 routes an <html> root directly to document.documentElement instead of
// the test container, so we pass `baseElement: document.documentElement` and
// query within `<head>` directly.
describe('RootLayout (F1 favicon)', () => {
  it('renders <meta name="theme-color" content="#5A4530"> in <head>', () => {
    const { baseElement } = render(
      <RootLayout>
        <div data-testid="child">x</div>
      </RootLayout>,
      { container: document.head.appendChild(document.createElement('div')) },
    );
    const meta = document.head.querySelector('meta[name="theme-color"]');
    expect(meta).toBeInTheDocument();
    expect(meta?.getAttribute('content')).toBe('#5A4530');
    void baseElement;
  });

  it('renders <link rel="manifest" href="/manifest.json"> in <head>', () => {
    render(
      <RootLayout>
        <div>x</div>
      </RootLayout>,
      { container: document.head.appendChild(document.createElement('div')) },
    );
    const link = document.head.querySelector('link[rel="manifest"]');
    expect(link).toBeInTheDocument();
    expect(link?.getAttribute('href')).toBe('/manifest.json');
  });
});