// app/sitemap/ancient.xml/route.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRuntimeSiteUrl } from '@/lib/seo/config';

export const revalidate = 3600;

export async function GET() {
  const raw = readFileSync(join(process.cwd(), 'data', 'classics-manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as { updatedAt: string; books: { slug: string }[] };
  const base = await getRuntimeSiteUrl();
  const lastmod = new Date(manifest.updatedAt).toISOString();
  const urls = manifest.books
    .map((b) => `<url><loc>${base}/ancient/${b.slug}</loc><lastmod>${lastmod}</lastmod><priority>0.7</priority></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}
