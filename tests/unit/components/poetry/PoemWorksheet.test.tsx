// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PoemWorksheet } from '@/components/poetry/PoemWorksheet';

describe('PoemWorksheet', () => {
  it('renders one line per content entry', () => {
    const { container } = render(
      <PoemWorksheet
        content={['床前明月光', '疑是地上霜']}
        pinyin={[['chuáng', 'qián', 'míng', 'yuè', 'guāng'], ['yí', 'shì', 'dì', 'shàng', 'shuāng']]}
      />
    );
    expect(container.querySelectorAll('.poem-line')).toHaveLength(2);
    expect(container.querySelectorAll('.poem-char')).toHaveLength(10);
  });

  it('shows pinyin under each char', () => {
    render(
      <PoemWorksheet
        content={['静夜思']}
        pinyin={[['jìng', 'yè', 'sī']]}
      />
    );
    expect(screen.getByText('jìng')).toBeInTheDocument();
    expect(screen.getByText('yè')).toBeInTheDocument();
    expect(screen.getByText('sī')).toBeInTheDocument();
  });
});
