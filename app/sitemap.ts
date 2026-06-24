import type { MetadataRoute } from 'next';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { loadManifest } from '@/lib/poetry';
import { getRuntimeSiteUrl } from '@/lib/seo/config';

interface ClassicsManifest { updatedAt: string; books: Array<{ slug: string }>; }
interface ContentManifest { generatedAt: string; }
interface SutrasManifest { generatedAt: string; items: Array<{ id: number; slug: string }>; }

function loadJsonSync<T>(p: string): T | null {
  try { return JSON.parse(readFileSync(path.join(process.cwd(), p), 'utf8')) as T; }
  catch { return null; }
}

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getRuntimeSiteUrl();
  // Read all data from JSON manifests so the build can prerender without DB.
  // Sutras previously read from MySQL — now read data/sutras/manifest.json.
  const [manifest, classics, content, sutrasManifest] = await Promise.all([
    loadManifest(),
    Promise.resolve(loadJsonSync<ClassicsManifest>('data/classics-manifest.json')),
    Promise.resolve(loadJsonSync<ContentManifest>('data/content-manifest.json')),
    Promise.resolve(loadJsonSync<SutrasManifest>('data/sutras/manifest.json')),
  ]);

  const poems = manifest.items.map(i => ({
    url: `${base}/poetry/${i.id}`,
    lastModified: manifest.updatedAt,
  }));

  const classicsEntries = (classics?.books ?? []).map(b => ({
    url: `${base}/ancient/${b.slug}`,
    lastModified: classics!.updatedAt,
  }));

  const sutraMtime = sutrasManifest?.generatedAt ?? manifest.updatedAt;
  const sutraEntries = (sutrasManifest?.items ?? []).map(s => ({
    url: `${base}/sutra/${s.slug}`,
    lastModified: sutraMtime,
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
