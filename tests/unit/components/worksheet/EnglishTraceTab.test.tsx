// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { EnglishTraceTab } from '@/components/worksheet/EnglishTraceTab';

afterEach(() => cleanup());

describe('EnglishTraceTab — layout', () => {
  it('renders a textarea + 3 case toggle buttons (原文 / 全部大写 / 全部小写)', () => {
    render(<EnglishTraceTab value={[]} onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: '原文' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '全部大写' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '全部小写' })).toBeTruthy();
  });

  it('shows "0 个字母" when value is empty', () => {
    render(<EnglishTraceTab value={[]} onChange={() => {}} />);
    expect(screen.getByText(/已输入 0 个字母/)).toBeTruthy();
  });

  it('reflects the value length in the count message', () => {
    render(<EnglishTraceTab value={['A', 'b', 'C']} onChange={() => {}} />);
    expect(screen.getByText(/已输入 3 个字母/)).toBeTruthy();
  });
});

describe('EnglishTraceTab — case modes', () => {
  it('as-is mode: typing "Hello" emits ["H","e","l","l","o"]', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EnglishTraceTab value={[]} onChange={onChange} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello');
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toEqual(['H', 'e', 'l', 'l', 'o']);
  });

  it('upper mode transforms input to uppercase', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EnglishTraceTab value={[]} onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'Hello');
    await user.click(screen.getByRole('button', { name: '全部大写' }));
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toEqual(['H', 'E', 'L', 'L', 'O']);
  });

  it('lower mode transforms input to lowercase', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EnglishTraceTab value={[]} onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'Hello');
    await user.click(screen.getByRole('button', { name: '全部小写' }));
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toEqual(['h', 'e', 'l', 'l', 'o']);
  });
});

describe('EnglishTraceTab — input filtering', () => {
  it('strips spaces, punctuation, and digits — keeps only A-Z/a-z', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EnglishTraceTab value={[]} onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'Hello, World! 123 ABC?');
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toEqual(['H', 'e', 'l', 'l', 'o', 'W', 'o', 'r', 'l', 'd', 'A', 'B', 'C']);
  });

  it('strips non-ASCII (rejects CJK chars, accented Latin, etc.)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EnglishTraceTab value={[]} onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), '你好abc café');
    const last = onChange.mock.calls.at(-1)?.[0];
    // 'é' is accented Latin (non-ASCII) → filtered out, so only "abccaf" remains
    expect(last).toEqual(['a', 'b', 'c', 'c', 'a', 'f']);
  });

  it('switching back to as-is after upper/lower preserves the typed case', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EnglishTraceTab value={[]} onChange={onChange} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello');
    await user.click(screen.getByRole('button', { name: '全部大写' }));
    const upper = onChange.mock.calls.at(-1)?.[0];
    expect(upper).toEqual(['H', 'E', 'L', 'L', 'O']);
    await user.click(screen.getByRole('button', { name: '原文' }));
    const back = onChange.mock.calls.at(-1)?.[0];
    expect(back).toEqual(['H', 'e', 'l', 'l', 'o']);
  });
});