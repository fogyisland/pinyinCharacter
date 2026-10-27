// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { McpTokenActions } from '@/components/mcp/McpTokenActions';
import type { McpTokenStatus } from '@/lib/mcp-token';

/**
 * The MCP token card on /profile.
 *
 * The card is tested through `McpTokenActions` (the client island) and not
 * through `McpTokenCard` (the server component): the latter awaits
 * `getTokenStatus(userId)`, which needs a database. The client island takes
 * the status as a prop, so it can be rendered — and driven through a mocked
 * fetch — in a unit test.
 */

const ENDPOINT = 'https://ziyun.example.com/mcp';
const RAW_TOKEN = 'mcp_RAWTOKEN0123456789abcdefghijklmnop';

/** The literal the client config template carries when no raw token exists. */
const TOKEN_PLACEHOLDER = 'Bearer mcp_<the raw token>';

const NONE: McpTokenStatus = {
  state: 'none',
  createdAt: null,
  lastUsedAt: null,
  revokedAt: null,
};

const ACTIVE: McpTokenStatus = {
  state: 'active',
  createdAt: '2026-10-20T08:00:00.000Z',
  lastUsedAt: '2026-10-21T09:00:00.000Z',
  revokedAt: null,
};

const REVOKED: McpTokenStatus = {
  state: 'revoked',
  createdAt: '2026-10-20T08:00:00.000Z',
  lastUsedAt: '2026-10-21T09:00:00.000Z',
  revokedAt: '2026-10-22T10:00:00.000Z',
};

/**
 * The POST answer of /api/mcp/token.
 *
 * Its `config` carries the *real* token (`buildConfig(endpoint, issued.raw)`
 * in the route) — the component must not copy that block into the card, or
 * the "shown only once" promise breaks on the spot.
 */
const POST_BODY = {
  ok: true,
  data: {
    token: RAW_TOKEN,
    createdAt: '2026-10-27T10:00:00.000Z',
    endpoint: ENDPOINT,
    config: {
      mcpServers: {
        'ziyun-chinese': {
          type: 'http',
          url: ENDPOINT,
          headers: { Authorization: `Bearer ${RAW_TOKEN}` },
        },
      },
    },
  },
};

const DELETE_BODY = {
  ok: true,
  data: { revokedAt: '2026-10-27T11:00:00.000Z' },
};

interface MockAnswer {
  status?: number;
  body?: unknown;
}

/**
 * Install a fetch mock that answers with the given envelopes, in order.
 *
 * The last answer is repeated once the sequence runs out, so a test that
 * clicks twice does not need to spell out the third answer.
 */
function stubFetch(answers: MockAnswer[]): ReturnType<typeof vi.fn> {
  let index = 0;
  const fetchMock = vi.fn(async () => {
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    const status = answer.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => answer.body ?? {},
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The URL and the method of the nth fetch call. */
function callOf(
  fetchMock: ReturnType<typeof vi.fn>,
  index: number,
): { url: string; method: string } {
  const [url, options] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url, method: options.method ?? 'GET' };
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  // Every test installs its own fetch mock; without this the next test
  // would answer with the previous test's mock (the classic false green).
  vi.unstubAllGlobals();
});

describe('McpTokenActions', () => {
  it('offers to issue a token when the user has none', () => {
    render(<McpTokenActions initialStatus={NONE} endpoint={ENDPOINT} />);
    expect(screen.getByRole('button', { name: '申请 MCP Token' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新生成' })).toBeNull();
    expect(screen.queryByRole('button', { name: '吊销' })).toBeNull();
  });

  it('offers rotation and revocation when a token is active', () => {
    render(<McpTokenActions initialStatus={ACTIVE} endpoint={ENDPOINT} />);
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '吊销' })).toBeInTheDocument();
    expect(screen.getByTestId('mcp-config')).toHaveTextContent('mcpServers');
  });

  it('offers to issue a token again after a revocation', () => {
    render(<McpTokenActions initialStatus={REVOKED} endpoint={ENDPOINT} />);
    expect(screen.getByRole('button', { name: '申请 MCP Token' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '吊销' })).toBeNull();
  });

  it('issues a token and shows the raw token once', async () => {
    const fetchMock = stubFetch([{ body: POST_BODY }]);
    render(<McpTokenActions initialStatus={NONE} endpoint={ENDPOINT} />);

    fireEvent.click(screen.getByRole('button', { name: '申请 MCP Token' }));
    await waitFor(() => expect(screen.getByTestId('mcp-token')).toBeInTheDocument());

    expect(callOf(fetchMock, 0)).toEqual({ url: '/api/mcp/token', method: 'POST' });
    expect(screen.getByText(RAW_TOKEN)).toBeInTheDocument();
    expect(screen.getByText('只显示一次，关闭后无法再次查看')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument();
    // none -> active
    expect(screen.getByRole('button', { name: '吊销' })).toBeInTheDocument();
  });

  it('keeps the raw token out of the client config block', async () => {
    stubFetch([{ body: POST_BODY }]);
    render(<McpTokenActions initialStatus={NONE} endpoint={ENDPOINT} />);

    fireEvent.click(screen.getByRole('button', { name: '申请 MCP Token' }));
    await waitFor(() => expect(screen.getByTestId('mcp-token')).toBeInTheDocument());

    const config = screen.getByTestId('mcp-config');
    expect(config).toHaveTextContent('mcpServers');
    expect(config).toHaveTextContent(TOKEN_PLACEHOLDER);
    expect(config).not.toHaveTextContent(RAW_TOKEN);
  });

  it('revokes the token and takes the raw token off the page', async () => {
    const fetchMock = stubFetch([{ body: POST_BODY }, { body: DELETE_BODY }]);
    render(<McpTokenActions initialStatus={NONE} endpoint={ENDPOINT} />);

    fireEvent.click(screen.getByRole('button', { name: '申请 MCP Token' }));
    await waitFor(() => expect(screen.getByTestId('mcp-token')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '吊销' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '申请 MCP Token' })).toBeInTheDocument());

    expect(callOf(fetchMock, 1)).toEqual({ url: '/api/mcp/token', method: 'DELETE' });
    expect(screen.queryByText(RAW_TOKEN)).toBeNull();
    expect(screen.queryByTestId('mcp-token')).toBeNull();
  });

  it('copies the raw token to the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    try {
      stubFetch([{ body: POST_BODY }]);
      render(<McpTokenActions initialStatus={NONE} endpoint={ENDPOINT} />);

      fireEvent.click(screen.getByRole('button', { name: '申请 MCP Token' }));
      await waitFor(() => expect(screen.getByTestId('mcp-token')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: '复制' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(RAW_TOKEN));
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('shows a Chinese message and keeps the state when the request fails', async () => {
    stubFetch([
      { status: 500, body: { ok: false, error: { code: 'server', message: '服务暂时不可用' } } },
    ]);
    render(<McpTokenActions initialStatus={NONE} endpoint={ENDPOINT} />);

    fireEvent.click(screen.getByRole('button', { name: '申请 MCP Token' }));
    await waitFor(() => expect(screen.getByText('服务暂时不可用')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: '申请 MCP Token' })).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-token')).toBeNull();
  });

  it('reports an expired session by the status code, not by the body', async () => {
    stubFetch([
      { status: 401, body: { ok: false, error: { code: 'unauthorized', message: '未登录' } } },
    ]);
    render(<McpTokenActions initialStatus={NONE} endpoint={ENDPOINT} />);

    fireEvent.click(screen.getByRole('button', { name: '申请 MCP Token' }));
    await waitFor(() => expect(screen.getByText('登录已失效，请重新登录')).toBeInTheDocument());

    expect(screen.queryByText('未登录')).toBeNull();
  });

  it('reports a disabled account by the status code', async () => {
    stubFetch([
      { status: 403, body: { ok: false, error: { code: 'forbidden', message: '账户已停用' } } },
    ]);
    render(<McpTokenActions initialStatus={NONE} endpoint={ENDPOINT} />);

    fireEvent.click(screen.getByRole('button', { name: '申请 MCP Token' }));
    await waitFor(() => expect(screen.getByText('账户已停用')).toBeInTheDocument());
  });

  it('reports a network failure instead of failing silently', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    // The card logs the failure; the log is asserted below and swallowed
    // here so the test output stays clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<McpTokenActions initialStatus={NONE} endpoint={ENDPOINT} />);

      fireEvent.click(screen.getByRole('button', { name: '申请 MCP Token' }));
      await waitFor(() => expect(screen.getByText('网络错误，请稍后再试')).toBeInTheDocument());
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
