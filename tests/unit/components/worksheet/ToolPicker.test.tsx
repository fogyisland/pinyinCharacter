// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolPicker } from '@/components/worksheet/ToolPicker';

describe('ToolPicker', () => {
  it('renders two radios: 毛笔 and 钢笔', () => {
    render(<ToolPicker value="brush" onChange={() => {}} />);
    expect(screen.getByLabelText('毛笔')).toBeInTheDocument();
    expect(screen.getByLabelText('钢笔')).toBeInTheDocument();
  });

  it('checks the radio matching value', () => {
    render(<ToolPicker value="pen" onChange={() => {}} />);
    expect(screen.getByLabelText('钢笔')).toBeChecked();
    expect(screen.getByLabelText('毛笔')).not.toBeChecked();
  });

  it('fires onChange with new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToolPicker value="brush" onChange={onChange} />);
    await user.click(screen.getByLabelText('钢笔'));
    expect(onChange).toHaveBeenCalledWith('pen');
  });
});