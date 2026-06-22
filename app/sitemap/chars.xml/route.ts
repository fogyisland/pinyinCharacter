// app/sitemap/chars.xml/route.ts
import { getPool } from '@/lib/db';
import { getSiteUrl } from '@/lib/seo/config';

export const revalidate = 3600;

export async function GET() {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`SELECT \`char\` FROM chars ORDER BY \`char\``);
  const base = getSiteUrl();
  const lastmod = new Date().toISOString();
  const urls = (rows as any[])
    .map((r) => `<url><loc>${base}/dictionary/${encodeURIComponent(r.char)}</loc><lastmod>${lastmod}</lastmod><priority>0.6</priority></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}
