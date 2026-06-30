export type SutraBackSource = 'dictionary' | 'rare-chars' | 'sutras';

const BACK_LINKS: Record<SutraBackSource, { href: string; label: string }> = {
  dictionary: { href: '/dictionary', label: '返回字典' },
  'rare-chars': { href: '/rare-chars', label: '返回罕见字库' },
  sutras: { href: '/sutra', label: '返回经文目录' },
};

export function getSutraBackLink(from: string | undefined): { href: string; label: string } {
  if (from && (from as SutraBackSource) in BACK_LINKS) {
    return BACK_LINKS[from as SutraBackSource];
  }
  return BACK_LINKS.sutras;
}
