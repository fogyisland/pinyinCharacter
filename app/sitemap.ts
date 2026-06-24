import type { MetadataRoute } from 'next';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { getPool } from '@/lib/db';
import { loadManifest } from '@/lib/poetry';
import { getRuntimeSiteUrl } from '@/lib/seo/config';

interface ClassicsManifest { updatedAt: string; books: Array<{ slug: string }>; }
interface ContentManifest { generatedAt: string; }
interface SutraRow { id: number; slug: string; created_at: Date; }

function loadJsonSync<T>(p: string): T | null {
  try { return JSON.parse(readFileSync(path.join(process.cwd(), p), 'utf8')) as T; }
  catch { return null; }
}

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getRuntimeSiteUrl();
  const [manifest, classics, content, sutras] = await Promise.all([
    loadManifest(),
    Promise.resolve(loadJsonSync<ClassicsManifest>('data/classics-manifest.json')),
    Promise.resolve(loadJsonSync<ContentManifest>('data/content-manifest.json')),
    getPool().query<any[]>(`SELECT id, slug, created_at FROM sutras ORDER BY id`),
  ]);

  const poems = manifest.items.map(i => ({
    url: `${base}/poetry/${i.id}`,
    lastModified: manifest.updatedAt,
  }));

  const classicsEntries = (classics?.books ?? []).map(b => ({
    url: `${base}/ancient/${b.slug}`,
    lastModified: classics!.updatedAt,
  }));

  const [sutraRows] = sutras as [SutraRow[], any];
  const sutraEntries = sutraRows.map(s => ({
    url: `${base}/sutra/${s.slug}`,
    lastModified: s.created_at,
  }));

  // Static routes: use content-manifest.generatedAt as the "site content was
  // last touched" timestamp. Avoids emitting `new Date()` (which lies about
  // the content mtime and would re-trigger crawls on every request).
  const contentMtime = content?.generatedAt ?? manifest.updatedAt;
  const staticDate = new Date(contentMtime);

  return [
    { url: `${base}/`, lastModified: staticDate, priority: 1.0, changeFrequency: 'daily' },
    { url: `${base}/poetry`, lastModified: manifest.updatedAt, priority: 0.9, changeFrequency: 'daily' },
    { url: `${base}/ancient`, lastModified: classics?.updatedAt ?? staticDate, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${base}/dictionary`, lastModified: contentMtime, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${base}/sitemap/poetry.xml`, lastModified: manifest.updatedAt },
    { url: `${base}/sitemap/ancient.xml`, lastModified: classics?.updatedAt ?? staticDate },
    { url: `${base}/sitemap/chars.xml`, lastModified: contentMtime },
    ...poems,
    ...classicsEntries,
    ...sutraEntries,
  ];
}
