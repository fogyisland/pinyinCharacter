// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormFilterBar } from '@/components/poetry/FormFilterBar';

describe('FormFilterBar', () => {
  it('renders chips for each available form', () => {
    render(
      <FormFilterBar
        category="tang"
        availableForms={['五绝', '七绝', '五律']}
        selectedForms={[]}
        onChange={() => {}}
      />
    );
    expect(screen.getByText('五绝')).toBeDefined();
    expect(screen.getByText('七绝')).toBeDefined();
    expect(screen.getByText('五律')).toBeDefined();
  });

  it('returns null when no forms', () => {
    const { container } = render(
      <FormFilterBar category="tang" availableForms={[]} selectedForms={[]} onChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('toggles selection on click', () => {
    const onChange = vi.fn();
    render(
      <FormFilterBar
        category="tang"
        availableForms={['五绝', '七绝']}
        selectedForms={['五绝']}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('七绝'));
    expect(onChange).toHaveBeenCalledWith(['五绝', '七绝']);
  });

  it('removes selection on second click', () => {
    const onChange = vi.fn();
    render(
      <FormFilterBar
        category="tang"
        availableForms={['五绝', '七绝']}
        selectedForms={['五绝', '七绝']}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('五绝'));
    expect(onChange).toHaveBeenCalledWith(['七绝']);
  });
});