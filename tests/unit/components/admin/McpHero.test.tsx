// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { McpHero } from '@/components/admin/mcp/McpHero';
import { MCP_CAPABILITIES } from '@/mcp/capabilities';

/**
 * The head of the admin's MCP page.
 *
 * The panel is the first thing on the page, so it has to answer three
 * questions without the reader having to scroll: where the service is,
 * how many tools it has, and how a client reaches it.
 *
 * The third one has a sharp edge — the configuration must carry the
 * placeholder and never a live token, because the raw token belongs to
 * the user who asked for it and is shown exactly once on /profile.
 */

const ENDPOINT = 'https://ziyun.example.com/mcp';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Install a clipboard that records what was written to it. */
function stubClipboard() {
  const writeText = vi.fn(async (text: string): Promise<void> => {
    void text;
  });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

describe('McpHero', () => {
  it('leads with the endpoint, in full', () => {
    render(<McpHero endpoint={ENDPOINT} />);
    expect(screen.getByText(ENDPOINT)).toBeInTheDocument();
  });

  it('says how many tools the service has', () => {
    render(<McpHero endpoint={ENDPOINT} />);
    expect(screen.getByText(`${MCP_CAPABILITIES.length} 个工具`)).toBeInTheDocument();
  });

  it('says how the service authenticates', () => {
    render(<McpHero endpoint={ENDPOINT} />);
    expect(screen.getByText('Bearer Token 鉴权')).toBeInTheDocument();
  });

  it('copies the endpoint to the clipboard', async () => {
    const writeText = stubClipboard();
    render(<McpHero endpoint={ENDPOINT} />);

    fireEvent.click(screen.getByRole('button', { name: '复制地址' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ENDPOINT));
  });

  it('copies a configuration that carries the endpoint and the placeholder', async () => {
    const writeText = stubClipboard();
    render(<McpHero endpoint={ENDPOINT} />);

    fireEvent.click(screen.getByRole('button', { name: '复制客户端配置' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());

    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain(ENDPOINT);
    expect(copied).toContain('mcpServers');
    expect(copied).toContain('mcp_<the raw token>');
  });

  it('never carries a live token in the configuration', () => {
    render(<McpHero endpoint={ENDPOINT} />);
    // The panel is readable by anyone who can open the admin; a raw
    // token in it would leak to every operator who walks past.
    expect(screen.queryByText(/Bearer mcp_[A-Za-z0-9]{16,}/)).toBeNull();
  });

  it('says so when the clipboard refuses the write', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(async () => {
          throw new Error('the clipboard is not available');
        }),
      },
      configurable: true,
      writable: true,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<McpHero endpoint={ENDPOINT} />);

      fireEvent.click(screen.getByRole('button', { name: '复制地址' }));
      await waitFor(() => expect(screen.getByRole('button', { name: '复制失败' })).toBeInTheDocument());
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
