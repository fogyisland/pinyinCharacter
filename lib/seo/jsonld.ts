import { getSiteUrl, SITE_NAME } from './config';

export interface PoemForJsonLd {
  title: string;
  author: string;
  dynasty: string;
  content: string[];
}

export function buildCreativeWork(p: PoemForJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: p.title,
    author: { '@type': 'Person', name: p.author || '佚名' },
    inLanguage: 'zh-CN',
    text: p.content.join('\n'),
  };
}

export interface BookForJsonLd {
  title: string;
  author: string | null;
  era: string | null;
}

export function buildBook(b: BookForJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: b.title,
    author: { '@type': 'Person', name: b.author || '佚名' },
    inLanguage: 'zh-CN',
    ...(b.era ? { datePublished: b.era } : {}),
  };
}

export interface TermForJsonLd {
  char: string;
  meaning: string | null;
}

export function buildDefinedTerm(t: TermForJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: t.char,
    ...(t.meaning ? { description: t.meaning } : {}),
    inLanguage: 'zh-CN',
  };
}

export function buildBreadcrumbList(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: `${getSiteUrl()}${item.url.startsWith('/') ? item.url : '/' + item.url}`,
    })),
  };
}

export function buildOrganization() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: getSiteUrl(),
    logo: `${getSiteUrl()}/logo.png`,
  };
}

export function buildWebSite() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: getSiteUrl(),
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${getSiteUrl()}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}
