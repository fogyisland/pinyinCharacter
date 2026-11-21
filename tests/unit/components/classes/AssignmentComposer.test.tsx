// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AssignmentComposer } from '@/components/classes/AssignmentComposer';

/**
 * 派作业的表单。
 *
 * 它做的是一件事：把老师粘贴的内容变成两种载荷之一。最容易错的地方是
 * 「粘贴里带标点」—— 字帖的字会进格子，标点进了格子学生不知道该写什么。
 */

const { createAssignmentRequestMock } = vi.hoisted(() => ({
  createAssignmentRequestMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/lib/api-classes', () => ({
  createAssignmentRequest: createAssignmentRequestMock,
}));

beforeEach(() => {
  createAssignmentRequestMock.mockReset();
  createAssignmentRequestMock.mockResolvedValue({ ok: true, data: { id: 5 } });
});

afterEach(() => {
  cleanup();
});

describe('AssignmentComposer', () => {
  it('strips punctuation from a worksheet assignment', async () => {
    // 老师会直接粘贴「学生，老师。」这种带标点的文本 —— 逗号不能进格子。
    const onDone = vi.fn();
    render(<AssignmentComposer classId={7} onDone={onDone} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('作业标题'), { target: { value: '第 3 课' } });
    fireEvent.change(screen.getByLabelText('作业内容'), { target: { value: '学生，老师。学校！' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    const body = createAssignmentRequestMock.mock.calls[0][1] as {
      kind: string;
      chars: string[];
    };
    expect(body.kind).toBe('worksheet');
    expect(body.chars).toEqual(['学', '生', '老', '师', '学', '校']);
  });

  it('splits a dictation assignment on commas and newlines', async () => {
    render(<AssignmentComposer classId={7} onDone={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: '听写' }));
    fireEvent.change(screen.getByLabelText('作业标题'), { target: { value: '听写' } });
    fireEvent.change(screen.getByLabelText(/要听写的词/), {
      target: { value: '学生，老师\n学校' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await waitFor(() => expect(createAssignmentRequestMock).toHaveBeenCalled());

    const body = createAssignmentRequestMock.mock.calls[0][1] as {
      kind: string;
      items: Array<{ word: string; pinyin: string }>;
    };
    expect(body.kind).toBe('dictation');
    expect(body.items.map((item) => item.word)).toEqual(['学生', '老师', '学校']);
  });

  it('refuses to publish an assignment with no content', async () => {
    render(<AssignmentComposer classId={7} onDone={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('作业标题'), { target: { value: '空作业' } });
    fireEvent.change(screen.getByLabelText('作业内容'), { target: { value: '，。！' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('还没有字');
    });
    expect(createAssignmentRequestMock).not.toHaveBeenCalled();
  });

  it('keeps the publish button disabled until there is a title', () => {
    render(<AssignmentComposer classId={7} onDone={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: '发布' })).toHaveProperty('disabled', true);
  });

  it('passes the due date through', async () => {
    render(<AssignmentComposer classId={7} onDone={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('作业标题'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('作业内容'), { target: { value: '学' } });
    fireEvent.change(screen.getByLabelText('截止日期'), { target: { value: '2026-11-28' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await waitFor(() => expect(createAssignmentRequestMock).toHaveBeenCalled());
    const body = createAssignmentRequestMock.mock.calls[0][1] as { dueAt: string | null };
    expect(body.dueAt).toBe('2026-11-28');
  });

  it('reports a server rejection instead of closing the form', async () => {
    createAssignmentRequestMock.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: '只有老师能派作业' },
    });
    const onDone = vi.fn();
    render(<AssignmentComposer classId={7} onDone={onDone} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('作业标题'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('作业内容'), { target: { value: '学' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('只有老师能派作业');
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});
