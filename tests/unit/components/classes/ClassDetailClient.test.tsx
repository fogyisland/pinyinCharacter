// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ClassDetailClient } from '@/components/classes/ClassDetailClient';

/**
 * 班级详情页的完成状态。
 *
 * 两个视角在这一页里分开：
 *   学生 —— 「我练完了」按钮与撤销，以及自己的留言；
 *   老师 —— 全班的完成人数与已完成者名单。
 *
 * 完成的口径是学生自己勾选（不是打印），所以页面上既不该出现「打印即完成」
 * 的暗示，也不能把老师的视角画成和学生一样的复选框。
 */

const {
  fetchClassDetailMock,
  submitAssignmentRequestMock,
  withdrawSubmissionRequestMock,
  deleteAssignmentRequestMock,
  removeMemberRequestMock,
  fetchDictationResultsRequestMock,
  submitDictationResultRequestMock,
  withdrawDictationResultRequestMock,
} = vi.hoisted(() => ({
  fetchClassDetailMock: vi.fn(),
  submitAssignmentRequestMock: vi.fn(),
  withdrawSubmissionRequestMock: vi.fn(),
  deleteAssignmentRequestMock: vi.fn(),
  removeMemberRequestMock: vi.fn(),
  fetchDictationResultsRequestMock: vi.fn(),
  submitDictationResultRequestMock: vi.fn(),
  withdrawDictationResultRequestMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/api-classes', () => ({
  fetchClassDetail: fetchClassDetailMock,
  submitAssignmentRequest: submitAssignmentRequestMock,
  withdrawSubmissionRequest: withdrawSubmissionRequestMock,
  deleteAssignmentRequest: deleteAssignmentRequestMock,
  removeMemberRequest: removeMemberRequestMock,
  fetchDictationResultsRequest: fetchDictationResultsRequestMock,
  submitDictationResultRequest: submitDictationResultRequestMock,
  withdrawDictationResultRequest: withdrawDictationResultRequestMock,
}));

vi.mock('@/components/classes/AssignmentComposer', () => ({
  AssignmentComposer: () => <div data-composer />,
}));

function detail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    data: {
      id: 7,
      name: 'HSK1 周三班',
      note: '',
      role: 'student',
      joinCode: null,
      teacherId: 3,
      members: [
        { userId: 3, username: '王老师', joinedAt: '2026-11-01T00:00:00Z' },
        { userId: 9, username: '小明', joinedAt: '2026-11-02T00:00:00Z' },
        { userId: 10, username: '小红', joinedAt: '2026-11-03T00:00:00Z' },
      ],
      assignments: [
        {
          id: 5,
          title: '第 3 课生字',
          kind: 'worksheet',
          payload: { kind: 'worksheet', title: '第 3 课生字', worksheetId: 0, chars: ['学'] },
          dueAt: '2026-11-28',
          createdAt: '2026-11-20T00:00:00Z',
        },
      ],
      progress: { 5: [10] },
      mySubmissions: {},
      ...overrides,
    },
  };
}

beforeEach(() => {
  fetchClassDetailMock.mockReset();
  submitAssignmentRequestMock.mockReset();
  withdrawSubmissionRequestMock.mockReset();
  deleteAssignmentRequestMock.mockReset();
  removeMemberRequestMock.mockReset();
  fetchDictationResultsRequestMock.mockReset();
  submitDictationResultRequestMock.mockReset();
  withdrawDictationResultRequestMock.mockReset();
  fetchClassDetailMock.mockResolvedValue(detail());
  submitAssignmentRequestMock.mockResolvedValue({ ok: true, data: { recorded: true } });
  withdrawSubmissionRequestMock.mockResolvedValue({ ok: true, data: { cleared: true } });
  fetchDictationResultsRequestMock.mockResolvedValue({
    ok: true,
    data: { resultsByAssignment: {} },
  });
  submitDictationResultRequestMock.mockResolvedValue({
    ok: true,
    data: { recorded: true, total: 10, correct: 8 },
  });
  withdrawDictationResultRequestMock.mockResolvedValue({ ok: true, data: { cleared: true } });
});

afterEach(() => {
  cleanup();
});

describe('ClassDetailClient — student view', () => {
  it('shows how many classmates finished', async () => {
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText('第 3 课生字')).toBeTruthy());
    expect(screen.getByTestId('progress-5').textContent).toContain('1 / 3');
  });

  it('offers the submit button to a student who has not finished', async () => {
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText('第 3 课生字')).toBeTruthy());
    expect(screen.getByRole('button', { name: '我练完了' })).toBeTruthy();
  });

  it('submits when the student clicks it', async () => {
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '我练完了' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '我练完了' }));
    await waitFor(() => expect(submitAssignmentRequestMock).toHaveBeenCalledWith(7, 5, ''));
  });

  it('shows the finished state and offers a withdraw instead', async () => {
    fetchClassDetailMock.mockResolvedValue(
      detail({ mySubmissions: { 5: { note: '', completedAt: '2026-11-22T01:00:00Z' } } }),
    );
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText(/我练完了 · 2026-11-22/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: '我练完了' })).toBeNull();
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();
  });

  it('shows the student’s own note', async () => {
    fetchClassDetailMock.mockResolvedValue(
      detail({
        mySubmissions: { 5: { note: '第三行没看懂', completedAt: '2026-11-22T01:00:00Z' } },
      }),
    );
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText(/第三行没看懂/)).toBeTruthy());
  });

  it('does not show the teacher’s per-person list to a student', async () => {
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText('第 3 课生字')).toBeTruthy());
    // 「已完成：小红」这种逐人名只给老师看 —— 学生看别人的名字没有意义。
    expect(screen.queryByText(/已完成：/)).toBeNull();
  });
});

describe('ClassDetailClient — dictation assignment', () => {
  const dictationDetail = () =>
    detail({
      assignments: [
        {
          id: 7,
          title: '第 4 课听写',
          kind: 'dictation',
          payload: {
            kind: 'dictation',
            title: '第 4 课听写',
            items: [
              { word: '学生', pinyin: 'xué shēng' },
              { word: '老师', pinyin: 'lǎo shī' },
            ],
          },
          dueAt: null,
          createdAt: '2026-11-20T00:00:00Z',
        },
      ],
      progress: {},
      mySubmissions: {},
    });

  it('links the dictation assignment with BOTH ids', async () => {
    // The words are not in the URL: 200 words of JSON is ~6 KB and gets
    // truncated. Two ids stay short and let the runner fetch the list from
    // the class API, which enforces membership.
    fetchClassDetailMock.mockResolvedValue(dictationDetail());
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText('第 4 课听写')).toBeTruthy());
    const link = screen.getByRole('link', { name: '打开听写' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/dictation?classId=7&assignmentId=7');
  });

  it('tells the learner how many words the assignment holds', async () => {
    // A learner should be able to see the size of the task before clicking.
    fetchClassDetailMock.mockResolvedValue(dictationDetail());
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText('2 个词')).toBeTruthy());
  });

  it('does not add a word count to a worksheet assignment', async () => {
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText('第 3 课生字')).toBeTruthy());
    expect(screen.queryByText(/个词/)).toBeNull();
  });
});

describe('ClassDetailClient — teacher view', () => {
  const teacherDetail = () =>
    detail({
      role: 'teacher',
      joinCode: 'ABCDEF',
    });

  it('shows who finished and who did not', async () => {
    fetchClassDetailMock.mockResolvedValue(teacherDetail());
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText('第 3 课生字')).toBeTruthy());
    expect(screen.getByText(/已完成：小红/)).toBeTruthy();
  });

  it('says so when nobody has finished yet', async () => {
    fetchClassDetailMock.mockResolvedValue(detail({ role: 'teacher', progress: {} }));
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText(/还没有人/)).toBeTruthy());
  });

  it('does not give the teacher a 我练完了 button', async () => {
    // 老师批改，不交作业。给自己一个「我练完了」按钮只会让进度统计失真。
    fetchClassDetailMock.mockResolvedValue(teacherDetail());
    render(<ClassDetailClient classId={7} />);
    await waitFor(() => expect(screen.getByText('第 3 课生字')).toBeTruthy());
    expect(screen.queryByRole('button', { name: '我练完了' })).toBeNull();
  });
});
