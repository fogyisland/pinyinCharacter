// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RandomTab } from '@/components/worksheet/RandomTab';

describe('RandomTab (G3 title required)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { chars: [{ char: '你' }, { char: '好' }] } }),
    }) as any;
  });

  it('renders a title input (必填) above the count/difficulty grid', () => {
    render(<RandomTab title="my sheet" onTitleChange={vi.fn()} onPicked={vi.fn()} />);
    const titleInput = screen.getByPlaceholderText(/给字帖起个名字/);
    expect(titleInput).toBeInTheDocument();
    expect((titleInput as HTMLInputElement).value).toBe('my sheet');
  });

  it('clamps count to 1-100', async () => {
    render(<RandomTab title="t" onTitleChange={vi.fn()} onPicked={vi.fn()} />);
    const input = screen.getByDisplayValue('20') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '999' } });
    expect(input.value).toBe('100');
  });

  it('blocks generate and shows 请先填写字帖标题 when title is empty', async () => {
    const onPicked = vi.fn();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    render(<RandomTab title="" onTitleChange={vi.fn()} onPicked={onPicked} />);
    fireEvent.click(screen.getByText('随机生成'));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onPicked).not.toHaveBeenCalled();
    expect(await screen.findByText('请先填写字帖标题')).toBeInTheDocument();
  });

  it('blocks generate when title is whitespace-only', async () => {
    const onPicked = vi.fn();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    render(<RandomTab title="   " onTitleChange={vi.fn()} onPicked={onPicked} />);
    fireEvent.click(screen.getByText('随机生成'));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('请先填写字帖标题')).toBeInTheDocument();
  });

  it('calls onPicked with chars from API when title is non-empty', async () => {
    const onPicked = vi.fn();
    render(<RandomTab title="my sheet" onTitleChange={vi.fn()} onPicked={onPicked} />);
    fireEvent.click(screen.getByText('随机生成'));
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith(['你', '好']));
  });

  it('calls onTitleChange when the title input changes (clamped to 80 chars)', () => {
    const onTitleChange = vi.fn();
    render(<RandomTab title="" onTitleChange={onTitleChange} onPicked={vi.fn()} />);
    const input = screen.getByPlaceholderText(/给字帖起个名字/) as HTMLInputElement;
    const longText = 'a'.repeat(120);
    fireEvent.change(input, { target: { value: longText } });
    expect(onTitleChange).toHaveBeenCalledWith('a'.repeat(80));
  });
});

describe('RandomTab button label (hasContent)', () => {
  it('renders label 随机生成 when hasContent=false', () => {
    render(<RandomTab title="t" onTitleChange={vi.fn()} onPicked={vi.fn()} hasContent={false} />);
    expect(screen.getByRole('button', { name: /随机生成/ })).toBeInTheDocument();
  });

  it('renders label 重新生成 when hasContent=true', () => {
    render(<RandomTab title="t" onTitleChange={vi.fn()} onPicked={vi.fn()} hasContent={true} />);
    expect(screen.getByRole('button', { name: /重新生成/ })).toBeInTheDocument();
    // Should NOT also show 随机生成 when content exists
    expect(screen.queryByText('随机生成')).toBeNull();
  });
});
