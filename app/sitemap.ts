import type { MetadataRoute } from 'next';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadManifest } from '@/lib/poetry';
import { getSiteUrl } from '@/lib/seo/config';

interface ClassicsManifest { books: Array<{ slug: string }>; }
interface SutrasManifest { items?: Array<{ id: number }>; sutras?: Array<{ id: number }>; }

async function loadJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(path.join(process.cwd(), p), 'utf8')) as T; }
  catch { return null; }
}

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const manifest = await loadManifest();
  const classics = await loadJson<ClassicsManifest>('data/classics-manifest.json');
  const sutras = await loadJson<SutrasManifest>('data/sutras-manifest.json');

  const poems = manifest.items.map(i => ({
    url: `${base}/poetry/${i.id}`,
    lastModified: manifest.updatedAt,
  }));

  const classicsEntries = (classics?.books ?? []).map(b => ({
    url: `${base}/ancient/${b.slug}`,
    lastModified: new Date().toISOString(),
  }));

  const sutraIds = sutras?.items ?? sutras?.sutras ?? [];
  const sutraEntries = sutraIds.map(s => ({
    url: `${base}/sutra/${s.id}`,
    lastModified: new Date().toISOString(),
  }));

  const now = new Date();

  return [
    { url: `${base}/`, lastModified: now, priority: 1.0, changeFrequency: 'daily' },
    { url: `${base}/poetry`, lastModified: manifest.updatedAt, priority: 0.9, changeFrequency: 'daily' },
    { url: `${base}/ancient`, lastModified: now, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${base}/dictionary`, lastModified: now, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${base}/sitemap/poetry.xml`, lastModified: now },
    { url: `${base}/sitemap/ancient.xml`, lastModified: now },
    { url: `${base}/sitemap/chars.xml`, lastModified: now },
    ...poems,
    ...classicsEntries,
    ...sutraEntries,
  ];
}
