// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * 班级页。
 *
 * 三个入口共用一页：建班、用邀请码进班、看自己所在的班。老师看到邀请码
 * 并可以复制；学生看到「退出」而不是「解散」。
 */

const {
  fetchMyClassesMock,
  createClassRequestMock,
  joinClassRequestMock,
} = vi.hoisted(() => ({
  fetchMyClassesMock: vi.fn(),
  createClassRequestMock: vi.fn(),
  joinClassRequestMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/api-classes', () => ({
  fetchMyClasses: fetchMyClassesMock,
  createClassRequest: createClassRequestMock,
  joinClassRequest: joinClassRequestMock,
}));

vi.mock('@/lib/store', () => ({
  useAppStore: (selector: (state: { user: { id: number; username: string } }) => unknown) =>
    selector({ user: { id: 3, username: '王老师' } }),
}));

import { ClassesClient } from '@/components/classes/ClassesClient';

beforeEach(() => {
  fetchMyClassesMock.mockReset();
  createClassRequestMock.mockReset();
  joinClassRequestMock.mockReset();
  fetchMyClassesMock.mockResolvedValue({
    ok: true,
    data: {
      teaching: [{ id: 7, name: 'HSK1 周三班', joinCode: 'ABCDEF', note: '', memberCount: 12 }],
      joined: [{ id: 9, name: 'HSK2 周四班', note: '', teacherName: '李老师', memberCount: 8 }],
    },
  });
  createClassRequestMock.mockResolvedValue({ ok: true, data: { id: 7, joinCode: 'ABCDEF' } });
  joinClassRequestMock.mockResolvedValue({ ok: true, data: { classId: 9, created: true } });
});

afterEach(() => {
  cleanup();
});

describe('ClassesClient', () => {
  it('shows the classes the teacher runs with their invite codes', async () => {
    render(<ClassesClient />);
    await waitFor(() => {
      expect(screen.getByText('HSK1 周三班')).toBeTruthy();
    });
    // 邀请码要能被复制到群里，所以必须直接显示。
    expect(screen.getByText('ABCDEF')).toBeTruthy();
    expect(screen.getByText(/12 人/)).toBeTruthy();
  });

  it('shows the classes the user joined, with the teacher name', async () => {
    render(<ClassesClient />);
    await waitFor(() => {
      expect(screen.getByText('HSK2 周四班')).toBeTruthy();
    });
    expect(screen.getByText(/李老师/)).toBeTruthy();
  });

  it('creates a class and shows its invite code', async () => {
    render(<ClassesClient />);
    await waitFor(() => expect(screen.getByText('HSK1 周三班')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('班级名'), { target: { value: 'HSK3 周五班' } });
    fireEvent.click(screen.getByRole('button', { name: '建班' }));

    await waitFor(() => {
      expect(createClassRequestMock).toHaveBeenCalledWith('HSK3 周五班', '');
    });
    await waitFor(() => {
      expect(screen.getByText(/建班成功/)).toBeTruthy();
    });
  });

  it('reports a failed create instead of pretending it worked', async () => {
    createClassRequestMock.mockResolvedValue({
      ok: false,
      error: { code: 'bad_input', message: '班级名不能为空' },
    });
    render(<ClassesClient />);
    await waitFor(() => expect(screen.getByText('HSK1 周三班')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('班级名'), { target: { value: 'HSK4' } });
    fireEvent.click(screen.getByRole('button', { name: '建班' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('班级名不能为空');
    });
  });

  it('joins a class by invite code', async () => {
    render(<ClassesClient />);
    await waitFor(() => expect(screen.getByText('HSK1 周三班')).toBeTruthy());
    // The input upper-cases as you type: the bank of codes is uppercase, and
    // a learner copying from a chat message should not have to.
    fireEvent.change(screen.getByLabelText('邀请码'), { target: { value: 'abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    await waitFor(() => {
      expect(joinClassRequestMock).toHaveBeenCalledWith('ABCDEF');
    });
  });

  it('says when the user was already in the class', async () => {
    joinClassRequestMock.mockResolvedValue({ ok: true, data: { classId: 9, created: false } });
    render(<ClassesClient />);
    await waitFor(() => expect(screen.getByText('HSK1 周三班')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('邀请码'), { target: { value: 'ABCDEF' } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    await waitFor(() => {
      // 文案是一整段：`notice` 节点里的文本被 `createdCode` 的 span 拆开
      // 只在「建班成功」时发生，这里查的是 join 分支。
      expect(document.body.textContent).toContain('你本来就在这个班里');
    });
  });

  it('reports a bad invite code', async () => {
    joinClassRequestMock.mockResolvedValue({
      ok: false,
      error: { code: 'class_not_found', message: '邀请码不存在或已失效' },
    });
    render(<ClassesClient />);
    await waitFor(() => expect(screen.getByText('HSK1 周三班')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('邀请码'), { target: { value: 'ZZZZZZ' } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('邀请码不存在');
    });
  });

  it('shows an error state with a retry when the list fails to load', async () => {
    fetchMyClassesMock.mockRejectedValue(new Error('boom'));
    render(<ClassesClient />);
    await waitFor(() => {
      expect(screen.getByText(/班级列表暂时打不开/)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('shows an empty state when the user is in no class at all', async () => {
    fetchMyClassesMock.mockResolvedValue({ ok: true, data: { teaching: [], joined: [] } });
    render(<ClassesClient />);
    await waitFor(() => {
      expect(screen.getByText(/还没有班级/)).toBeTruthy();
    });
  });
});
