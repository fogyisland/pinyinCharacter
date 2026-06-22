// app/robots.ts
import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/seo/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/account'] }],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
