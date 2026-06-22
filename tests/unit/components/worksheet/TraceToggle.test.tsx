// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TraceToggle } from '@/components/worksheet/TraceToggle';

describe('TraceToggle', () => {
  it('renders a checkbox', () => {
    render(<TraceToggle value={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeDefined();
  });

  it('renders checked when value=true', () => {
    render(<TraceToggle value={true} onChange={() => {}} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('renders unchecked when value=false', () => {
    render(<TraceToggle value={false} onChange={() => {}} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('fires onChange(true) when toggled on', () => {
    const onChange = vi.fn();
    render(<TraceToggle value={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('fires onChange(false) when toggled off', () => {
    const onChange = vi.fn();
    render(<TraceToggle value={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('renders label 描红', () => {
    render(<TraceToggle value={false} onChange={() => {}} />);
    expect(screen.getByText('描红')).toBeDefined();
  });

  it('renders hint text for brush-only constraint', () => {
    render(<TraceToggle value={false} onChange={() => {}} />);
    expect(screen.getByText(/毛笔/)).toBeDefined();
  });
});