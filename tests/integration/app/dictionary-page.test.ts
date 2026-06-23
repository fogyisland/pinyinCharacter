import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCharDetail = vi.fn();
vi.mock('@/lib/chars', () => ({
  getCharDetail: (...a: any[]) => mockGetCharDetail(...a),
  isSuppPlaneChar: (c: string) => {
    if (!c) return false;
    const cp = c.codePointAt(0);
    return cp !== undefined && cp > 0xFFFF;
  },
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('@/components/Header', () => ({ Header: () => null }));
vi.mock('@/components/Footer', () => ({ Footer: () => null }));
vi.mock('@/components/common/PageContainer', () => ({
  PageContainer: ({ children }: any) => children,
  SectionTitle: ({ children, subtitle }: any) => `SectionTitle(${subtitle ?? ''})|${children}`,
}));
vi.mock('@/components/common/EmptyState', () => ({
  EmptyState: ({ title, description, action }: any) =>
    `EmptyState(${title}|${description ?? ''}|${action ? 'hasAction' : 'noAction'})`,
}));
vi.mock('@/components/dictionary/DictionaryDetailTabs', () => ({
  DictionaryDetailTabs: ({ char }: any) => `DictionaryDetailTabs(${char.char})`,
}));

async function renderDictionaryPage(char: string) {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: DictionaryPage } = await import('@/app/dictionary/[char]/page');
  const element = await DictionaryPage({
    params: Promise.resolve({ char: encodeURIComponent(char) }),
  } as any);
  return renderToStaticMarkup(element as any);
}

describe('dictionary page branching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders DictionaryDetailTabs when char found', async () => {
    mockGetCharDetail.mockResolvedValue({
      char: '永', level: 1, pinyin: 'yǒng', meaningZh: 'long', unicodeCodepoint: 'U+6C38',
    });
    const html = await renderDictionaryPage('永');
    expect(html).toContain('DictionaryDetailTabs(永)');
    expect(html).not.toContain('EmptyState');
  });

  it('renders supp-plane soft empty state for U+20000+', async () => {
    mockGetCharDetail.mockResolvedValue(null); // BMP filter returns null for supp-plane
    const html = await renderDictionaryPage('𠀀');
    expect(html).toContain('字库不支持该字符');
    expect(html).toContain('U+20000');
    expect(html).toContain('增补平面');
    expect(html).toContain('hasAction'); // back-to-dictionary link
    expect(html).not.toContain('DictionaryDetailTabs');
  });

  it('renders supp-plane soft empty state for 𬀩 (U+2C029)', async () => {
    mockGetCharDetail.mockResolvedValue(null);
    const html = await renderDictionaryPage('𬀩');
    expect(html).toContain('U+2C029');
    expect(html).toContain('字库不支持该字符');
  });

  it('throws 404 when BMP char is genuinely missing (not supp-plane, not in DB)', async () => {
    mockGetCharDetail.mockResolvedValue(null);
    await expect(renderDictionaryPage('A')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
