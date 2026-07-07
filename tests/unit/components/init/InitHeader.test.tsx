// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { InitHeader } from '@/components/init/InitHeader';

beforeEach(() => {
  cleanup();
});

describe('InitHeader', () => {
  it('renders 3 steps with labels', () => {
    const { getByText } = render(<InitHeader currentStep={0} />);
    expect(getByText('数据库')).toBeTruthy();
    expect(getByText('管理员')).toBeTruthy();
    expect(getByText('初始化数据')).toBeTruthy();
  });

  it('marks current step as active', () => {
    const { container } = render(<InitHeader currentStep={1} />);
    // the second step's wrapper div should have border-seal class
    const activeDots = container.querySelectorAll('.border-seal');
    expect(activeDots.length).toBeGreaterThanOrEqual(1);
  });
});