// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StepGroup } from '@/components/init/StepGroup';

beforeEach(() => {
  cleanup();
});

describe('StepGroup', () => {
  it('renders title with completion counter', () => {
    const { getByText } = render(
      <StepGroup title="数据库结构" completedCount={1} total={3}>
        <div data-testid="child">child content</div>
      </StepGroup>
    );
    expect(getByText('数据库结构')).toBeTruthy();
    expect(getByText('(1/3 完成)')).toBeTruthy();
  });

  it('renders children when defaultOpen=true', () => {
    const { getByTestId } = render(
      <StepGroup title="g" completedCount={0} total={2} defaultOpen>
        <div data-testid="child">c</div>
      </StepGroup>
    );
    expect(getByTestId('child')).toBeTruthy();
  });
});