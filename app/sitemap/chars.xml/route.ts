// app/sitemap/chars.xml/route.ts
import { getPool } from '@/lib/db';
import { getSiteUrl } from '@/lib/seo/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const revalidate = 3600;

export async function GET() {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`SELECT \`char\` FROM chars ORDER BY \`char\``);
  const base = getSiteUrl();
  // Use content-manifest.generatedAt as the lastmod for every char URL —
  // the chars table + content JSONs are updated together by the bulk-gen
  // pipeline, so all chars share the same effective mtime. Avoids emitting
  // new Date() (which would re-trigger crawls on every request).
  let lastmod: string;
  try {
    const m = JSON.parse(readFileSync(join(process.cwd(), 'data', 'content-manifest.json'), 'utf8')) as { generatedAt: string };
    lastmod = new Date(m.generatedAt).toISOString();
  } catch {
    lastmod = new Date().toISOString();
  }
  const urls = (rows as any[])
    .map((r) => `<url><loc>${base}/dictionary/${encodeURIComponent(r.char)}</loc><lastmod>${lastmod}</lastmod><priority>0.6</priority></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}
