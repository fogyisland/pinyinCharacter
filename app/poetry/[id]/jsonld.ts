import type { PoemDetail } from '@/lib/poetry-types';

export function buildPoemJsonLd(p: PoemDetail): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: p.title,
    author: { '@type': 'Person', name: p.author },
    inLanguage: 'zh-Hans',
    genre: p.form ?? undefined,
    text: p.content.join('\n'),
    isPartOf: { '@type': 'WebPage', name: '古诗词' },
  };
}