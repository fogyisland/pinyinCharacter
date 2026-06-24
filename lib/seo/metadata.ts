import type { Metadata } from 'next';
import { getRuntimeSiteUrl } from './config';

export interface BuildMetadataArgs {
  title: string;
  description: string;
  path: string;
  ogType?: 'website' | 'article' | 'book';
  image?: string;
}

export async function buildMetadata(args: BuildMetadataArgs): Promise<Metadata> {
  // Honor the admin-configured site URL override so canonical + og:url use
  // the real production domain instead of localhost.
  const base = await getRuntimeSiteUrl();
  const canonical = /^https?:\/\//.test(args.path)
    ? args.path
    : `${base}${args.path.startsWith('/') ? args.path : `/${args.path}`}`;
  const ogType = args.ogType ?? 'website';
  return {
    title: args.title,
    description: args.description,
    alternates: { canonical },
    openGraph: {
      title: args.title,
      description: args.description,
      url: canonical,
      type: ogType,
      ...(args.image ? { images: [{ url: args.image }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: args.title,
      description: args.description,
      ...(args.image ? { images: [args.image] } : {}),
    },
  };
}
