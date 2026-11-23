// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

/**
 * 听写页「从班级作业打开」的那条链路。
 *
 * 老师派了 10 个词，学生点「打开听写」——表单里必须已经有那 10 个词。
 * 这是这轮扫描里最像「功能坏了」的一项：链接指向 `?classId=&assignmentId=`，
 * 而表单一开始是空的，学生要自己重敲。
 *
 * 三条必须成立：
 *   1. 有链接时**从班级接口取词**（权限由服务端判，非本班成员拿不到）；
 *   2. 取到后**替换**草稿（不是追加 —— 学生是为这一份作业来的）；
 *   3. 取不到时**说清楚**，而不是给一个静默的空表单。
 */

const { fetchClassDetailMock, searchParamsMock } = vi.hoisted(() => ({
  fetchClassDetailMock: vi.fn(),
  searchParamsMock: new Map<string, string>(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => searchParamsMock.get(key) ?? null,
  }),
  usePathname: () => '/dictation',
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@/lib/api-classes', () => ({
  fetchClassDetail: fetchClassDetailMock,
}));

// The two halves render a lot; the assertion is about what the tabs hand
// them, so they are stubbed to print the item count.
vi.mock('@/components/dictation/DictationPrep', () => ({
  DictationPrep: ({ items }: { items: unknown[] }) => (
    <div data-testid="dictation-prep" data-item-count={items.length} />
  ),
}));
vi.mock('@/components/dictation/DictationRunner', () => ({
  DictationRunner: ({ items }: { items: unknown[] }) => (
    <div data-testid="dictation-runner" data-item-count={items.length} />
  ),
}));

import { DictationTabs } from '@/components/dictation/DictationTabs';

function classDetail(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      id: 7,
      name: 'HSK1 周三班',
      note: '',
      role: 'student',
      joinCode: null,
      teacherId: 3,
      members: [{ userId: 9, username: '小明', joinedAt: '2026-11-02T00:00:00Z' }],
      assignments: [
        {
          id: 12,
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
      ...overrides,
    },
  };
}

beforeEach(() => {
  fetchClassDetailMock.mockReset();
  searchParamsMock.clear();
  fetchClassDetailMock.mockResolvedValue(classDetail());
});

afterEach(() => {
  cleanup();
});

describe('DictationTabs — no class link', () => {
  it('starts empty and says nothing about an assignment', () => {
    render(<DictationTabs />);
    expect(screen.queryByTestId('assignment-source')).toBeNull();
    expect(screen.getByTestId('dictation-prep').getAttribute('data-item-count')).toBe('0');
    // No link means no request: a visitor opening the plain tool must not
    // hit the class API.
    expect(fetchClassDetailMock).not.toHaveBeenCalled();
  });
});

describe('DictationTabs — opened from a class assignment', () => {
  beforeEach(() => {
    searchParamsMock.set('classId', '7');
    searchParamsMock.set('assignmentId', '12');
  });

  it('fills the form with the assignment’s words', async () => {
    render(<DictationTabs />);
    await waitFor(() =>
      expect(screen.getByTestId('dictation-prep').getAttribute('data-item-count')).toBe('2'),
    );
    expect(fetchClassDetailMock).toHaveBeenCalledWith(7);
  });

  it('shows which assignment this is', async () => {
    render(<DictationTabs />);
    await waitFor(() => expect(screen.getByTestId('assignment-source').textContent).toContain('第 4 课听写'));
  });

  it('hands the same batch to the runner', async () => {
    // The two tabs share one draft; the runner must not be empty.
    searchParamsMock.set('tab', 'runner');
    render(<DictationTabs />);
    await waitFor(() =>
      expect(screen.getByTestId('dictation-runner').getAttribute('data-item-count')).toBe('2'),
    );
  });

  it('says so when the assignment was deleted', async () => {
    fetchClassDetailMock.mockResolvedValue(classDetail({ assignments: [] }));
    render(<DictationTabs />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('不在该班级里'),
    );
    // A learner still gets a usable, empty tool instead of a dead page.
    expect(screen.getByTestId('dictation-prep').getAttribute('data-item-count')).toBe('0');
  });

  it('says so when the class refuses the lookup', async () => {
    // The class API enforces membership; a link shared outside the class
    // must fail with that message, not with an empty form.
    fetchClassDetailMock.mockResolvedValue({
      ok: false,
      error: { code: 'class_not_found', message: '班级不存在' },
    });
    render(<DictationTabs />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('班级不存在'));
  });

  it('says a worksheet assignment is not a dictation', async () => {
    fetchClassDetailMock.mockResolvedValue(
      classDetail({
        assignments: [
          {
            id: 12,
            title: '第 3 课生字',
            kind: 'worksheet',
            payload: { kind: 'worksheet', title: '第 3 课生字', worksheetId: 0, chars: ['学'] },
            dueAt: null,
            createdAt: '2026-11-20T00:00:00Z',
          },
        ],
      }),
    );
    render(<DictationTabs />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('是字帖'));
  });

  it('ignores a half-formed link', async () => {
    // Only one id in the address bar resolves nothing.
    searchParamsMock.delete('assignmentId');
    render(<DictationTabs />);
    expect(fetchClassDetailMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('assignment-source')).toBeNull();
  });

  it('ignores an id that is not a number', async () => {
    searchParamsMock.set('classId', '7 OR 1=1');
    render(<DictationTabs />);
    expect(fetchClassDetailMock).not.toHaveBeenCalled();
  });
});
