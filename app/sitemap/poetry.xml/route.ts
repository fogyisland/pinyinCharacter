// app/sitemap/poetry.xml/route.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSiteUrl } from '@/lib/seo/config';

export const revalidate = 3600;

export async function GET() {
  const raw = readFileSync(join(process.cwd(), 'data', 'poems-manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as { updatedAt: string; items: { id: number }[] };
  const base = getSiteUrl();
  const lastmod = new Date(manifest.updatedAt).toISOString();
  const urls = manifest.items
    .map((i) => `<url><loc>${base}/poetry/${i.id}</loc><lastmod>${lastmod}</lastmod><priority>0.7</priority></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}
