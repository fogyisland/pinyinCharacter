import { describe, it, expect, afterEach } from 'vitest';
afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = undefined; });

describe('buildMetadata', () => {
  it('includes title, description, canonical, openGraph, twitter', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    const { buildMetadata } = await import('@/lib/seo/metadata');
    const m = await buildMetadata({ title: '静夜思', description: '床前明月光', path: '/poetry/1' });
    expect(m.title).toBe('静夜思');
    expect(m.description).toBe('床前明月光');
    expect(m.alternates?.canonical).toBe('https://x.com/poetry/1');
    expect(m.openGraph?.url).toBe('https://x.com/poetry/1');
    expect((m.twitter as { card?: string } | undefined)?.card).toBe('summary_large_image');
  });

  it('omits image when not provided', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    const { buildMetadata } = await import('@/lib/seo/metadata');
    const m = await buildMetadata({ title: 't', description: 'd', path: '/x' });
    expect(m.openGraph?.images).toBeUndefined();
  });
});
