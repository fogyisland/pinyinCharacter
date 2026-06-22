import type { Metadata } from 'next';
import { buildCanonicalUrl } from './config';

export interface BuildMetadataArgs {
  title: string;
  description: string;
  path: string;
  ogType?: 'website' | 'article' | 'book';
  image?: string;
}

export function buildMetadata(args: BuildMetadataArgs): Metadata {
  const canonical = buildCanonicalUrl(args.path);
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
