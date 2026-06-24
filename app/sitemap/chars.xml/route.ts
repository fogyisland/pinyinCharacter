// app/sitemap/chars.xml/route.ts
import { getRuntimeSiteUrl } from '@/lib/seo/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const revalidate = 3600;

// Filter to BMP-only — mysql2 mojibakes supp-plane chars in DB but the JSON
// file is the canonical source for the sitemap (file-based, no DB needed at build).
function loadBmpChars(): string[] {
  try {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), 'data', 'general-standard-chinese-characters.json'), 'utf8'),
    ) as string[];
    return raw.filter((c) => c.length === 1);
  } catch {
    return [];
  }
}

export async function GET() {
  const chars = loadBmpChars();
  const base = await getRuntimeSiteUrl();
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
  const urls = chars
    .map((ch) => `<url><loc>${base}/dictionary/${encodeURIComponent(ch)}</loc><lastmod>${lastmod}</lastmod><priority>0.6</priority></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}