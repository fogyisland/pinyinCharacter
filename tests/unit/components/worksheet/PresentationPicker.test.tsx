// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PresentationPicker } from '@/components/worksheet/PresentationPicker';

describe('PresentationPicker', () => {
  it('renders two radios: 田字格 and 米字格', () => {
    render(<PresentationPicker value="square" onChange={() => {}} />);
    expect(screen.getByLabelText('田字格')).toBeInTheDocument();
    expect(screen.getByLabelText('米字格')).toBeInTheDocument();
  });

  it('fires onChange with new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PresentationPicker value="square" onChange={onChange} />);
    await user.click(screen.getByLabelText('米字格'));
    expect(onChange).toHaveBeenCalledWith('cross');
  });
});