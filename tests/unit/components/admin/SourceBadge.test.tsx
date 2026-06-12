// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SourceBadge } from '@/components/admin/SourceBadge';

describe('SourceBadge', () => {
  it('renders the source label', () => {
    render(<SourceBadge source="audit" />);
    expect(screen.getByText('audit')).toBeInTheDocument();
  });
});
