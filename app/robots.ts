// app/robots.ts
import type { MetadataRoute } from 'next';
import { getRuntimeSiteUrl } from '@/lib/seo/config';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getRuntimeSiteUrl();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/account'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
