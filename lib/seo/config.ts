export const SITE_NAME = '字·韵';
export const SITE_LOCALE = 'zh_CN';
const FALLBACK = 'http://localhost:3000';

export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || FALLBACK;
  return raw.replace(/\/+$/, '');
}

export function buildCanonicalUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const leading = path.startsWith('/') ? path : `/${path}`;
  return `${getSiteUrl()}${leading}`;
}
