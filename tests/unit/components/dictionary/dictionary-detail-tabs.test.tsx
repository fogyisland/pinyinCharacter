// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DictionaryDetailTabs } from '@/components/dictionary/DictionaryDetailTabs';

const char = { char: '一', level: 1 as const, pinyin: 'yī', pinyinAlt: [], radical: '一', strokeCount: 1, meaningZh: '数目字', meaningEn: 'one', unicodeCodepoint: 'U+4E00', variants: [] };
const related = { ...char, relatedByRadical: [], relatedByPinyin: [] };

describe('DictionaryDetailTabs', () => {
  it('renders 4 tab labels', () => {
    render(<DictionaryDetailTabs char={related} />);
    expect(screen.getByText('字典')).toBeInTheDocument();
    expect(screen.getByText(/字源/)).toBeInTheDocument();
    expect(screen.getByText(/故事/)).toBeInTheDocument();
    expect(screen.getByText(/字帖/)).toBeInTheDocument();
  });
  it('shows dictionary fields', () => {
    render(<DictionaryDetailTabs char={related} />);
    expect(screen.getByText(/拼音/)).toBeInTheDocument();
    expect(screen.getByText(/部首/)).toBeInTheDocument();
    expect(screen.getByText(/释义/)).toBeInTheDocument();
    expect(screen.getByText(/英文/)).toBeInTheDocument();
    expect(screen.getByText(/Unicode/)).toBeInTheDocument();
    expect(screen.getByText(/异体/)).toBeInTheDocument();
  });
  it('字源 tab is a link to /etymology/[char]', () => {
    render(<DictionaryDetailTabs char={related} />);
    const link = screen.getByText(/^字源/);
    expect(link.closest('a')).toHaveAttribute('href', '/etymology/' + encodeURIComponent('一'));
  });
});