import type { MetadataRoute } from 'next';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadManifest } from '@/lib/poetry';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

interface ClassicsManifest { books: Array<{ slug: string }>; }
interface SutrasManifest { items?: Array<{ id: number }>; sutras?: Array<{ id: number }>; }

async function loadJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(path.join(process.cwd(), p), 'utf8')) as T; }
  catch { return null; }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const manifest = await loadManifest();
  const classics = await loadJson<ClassicsManifest>('data/classics-manifest.json');
  const sutras = await loadJson<SutrasManifest>('data/sutras-manifest.json');

  const poems = manifest.items.map(i => ({
    url: `${SITE_URL}/poetry/${i.id}`,
    lastModified: manifest.updatedAt,
  }));

  const classicsEntries = (classics?.books ?? []).map(b => ({
    url: `${SITE_URL}/ancient/${b.slug}`,
    lastModified: new Date().toISOString(),
  }));

  const sutraIds = sutras?.items ?? sutras?.sutras ?? [];
  const sutraEntries = sutraIds.map(s => ({
    url: `${SITE_URL}/sutra/${s.id}`,
    lastModified: new Date().toISOString(),
  }));

  return [
    { url: SITE_URL, lastModified: new Date().toISOString() },
    { url: `${SITE_URL}/poetry`, lastModified: manifest.updatedAt },
    { url: `${SITE_URL}/ancient`, lastModified: new Date().toISOString() },
    ...poems,
    ...classicsEntries,
    ...sutraEntries,
  ];
}