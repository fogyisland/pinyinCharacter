import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getRuntimeSiteUrl } from '@/lib/seo/config';

interface CharRow extends RowDataPacket {
  char: string;
}

function generateSitemapXml(
  urls: Array<{ loc: string; changefreq?: string; priority?: number }>,
): string {
  const entries = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n` +
        (u.changefreq ? `    <changefreq>${u.changefreq}</changefreq>\n` : '') +
        (u.priority !== undefined ? `    <priority>${u.priority}</priority>\n` : '') +
        `  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
}

export async function GET() {
  const pool = getPool();
  const baseUrl = await getRuntimeSiteUrl();
  const [rows] = await pool.query<CharRow[]>(
    `SELECT c.\`char\` FROM chars c
       INNER JOIN char_etymology e ON c.\`char\` = e.\`char\`
       WHERE c.\`char\` REGEXP '^[一-鿿]$'
       LIMIT 50000`,
  );
  const urls = rows.map((r) => ({
    loc: `${baseUrl}/etymology/${encodeURIComponent(r.char)}`,
    changefreq: 'monthly' as const,
    priority: 0.5,
  }));
  return new Response(generateSitemapXml(urls), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
