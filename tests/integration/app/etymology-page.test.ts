import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetChar = vi.fn();
const mockGetEtymology = vi.fn();
const mockGetAdjacentChars = vi.fn();
const mockNotFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });

vi.mock('@/lib/chars', () => ({
  getChar: (...a: any[]) => mockGetChar(...a),
}));
vi.mock('@/lib/etymology', () => ({
  getEtymology: (...a: any[]) => mockGetEtymology(...a),
  getAdjacentChars: (...a: any[]) => mockGetAdjacentChars(...a),
}));
vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

// Stub server-component layout/UI imports so we can assert on the JSX tree
// without pulling in mysql2 / fonts.
vi.mock('@/components/Header', () => ({ Header: () => null }));
vi.mock('@/components/Footer', () => ({ Footer: () => null }));
vi.mock('@/components/common/PageContainer', () => ({
  PageContainer: ({ children }: any) => children,
  SectionTitle: ({ children, subtitle }: any) => `SectionTitle(${subtitle ?? 'no-sub'})|${children}`,
}));
vi.mock('@/components/common/EmptyState', () => ({
  EmptyState: ({ title, description, action }: any) =>
    `EmptyState(${title}|${description ?? ''}|${action ? 'hasAction' : 'noAction'})`,
}));
vi.mock('@/components/etymology/EtymologyMorph', () => ({
  EtymologyMorph: ({ char, story }: any) => `EtymologyMorph(${char}|${story?.slice(0, 20) ?? 'null'})`,
}));
vi.mock('@/components/etymology/EtymologyPrevNext', () => ({
  EtymologyPrevNext: () => 'EtymologyPrevNext',
}));
vi.mock('@/components/ReadAloudButton', () => ({
  ReadAloudButton: () => 'ReadAloudButton',
}));

async function renderEtymologyPage(char: string) {
  const { default: EtymologyPage } = await import('@/app/etymology/[char]/page');
  // The page component is a React element; call its props.render to get the tree
  // Wait — for RSC we can't render directly. Use a thin wrapper: build the element
  // and let React renderToString.
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const element = await EtymologyPage({
    params: Promise.resolve({ char: encodeURIComponent(char) }),
  } as any);
  return renderToStaticMarkup(element as any);
}

describe('etymology page branching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdjacentChars.mockResolvedValue({ prev: 'a', next: 'b' });
  });

  it('404s when char is not in the chars table (even if etymology data exists somewhere)', async () => {
    mockGetChar.mockResolvedValue(null);
    mockGetEtymology.mockResolvedValue({ char: '𬀩', eraGlyphs: [], story: 'old story', level: 3 });
    await expect(renderEtymologyPage('𬀩')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('renders EtymologyMorph when char exists and has etymology', async () => {
    mockGetChar.mockResolvedValue({ char: '永' });
    mockGetEtymology.mockResolvedValue({
      char: '永',
      eraGlyphs: [{ era: 'kaishu', font: 'KaiTi', hasGlyph: true }],
      story: 'ancient glyph evolution story',
      level: 1,
    });
    const html = await renderEtymologyPage('永');
    expect(html).toContain('EtymologyMorph(永|ancient glyph evolu');
    expect(html).not.toContain('字库中无字源');
  });

  it('renders 字库中无字源 empty state when char exists but has no etymology', async () => {
    mockGetChar.mockResolvedValue({ char: '䶮' });
    mockGetEtymology.mockResolvedValue(null);
    const html = await renderEtymologyPage('䶮');
    expect(html).toContain('EmptyState(字库中无字源');
    expect(html).toContain('「䶮」尚未收录字源数据');
    expect(html).toContain('hasAction'); // dictionary link
    expect(html).not.toContain('EtymologyMorph(');
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('shows the 字形演变故事 subtitle when story exists, 字源即将生成 when it does not', async () => {
    mockGetChar.mockResolvedValue({ char: '甲' });
    mockGetEtymology.mockResolvedValue({
      char: '甲',
      eraGlyphs: [{ era: 'kaishu', font: 'KaiTi', hasGlyph: true }],
      story: 'a real story',
      level: 2,
    });
    const htmlWithStory = await renderEtymologyPage('甲');
    expect(htmlWithStory).toContain('字形演变故事');

    mockGetEtymology.mockResolvedValue({
      char: '甲',
      eraGlyphs: [{ era: 'kaishu', font: 'KaiTi', hasGlyph: true }],
      story: null,
      level: 2,
    });
    const htmlNoStory = await renderEtymologyPage('甲');
    expect(htmlNoStory).toContain('字源即将生成');
  });
});
