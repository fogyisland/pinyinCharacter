// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { McpCapabilityTree } from '@/components/admin/mcp/McpCapabilityTree';
import {
  MCP_CAPABILITIES,
  MCP_CAPABILITY_CATEGORY_LABELS,
} from '@/mcp/capabilities';

/**
 * The MCP catalogue, as a tree.
 *
 * The operator's question is "what can this service do?", and the answer
 * is twenty tools over eight subjects. The tree answers it in the
 * reader's order, and the rule the user set is that it is folded by
 * default: the subjects and their counts are always on screen, and the
 * tool names are one click away.
 *
 * These cases pin that rule down, and pin the counts against the
 * catalogue — a subject's count has to be the number of tools it really
 * has, and the counts have to add up to the whole catalogue.
 */

afterEach(() => {
  cleanup();
});

describe('McpCapabilityTree', () => {
  it('names every subject the catalogue has', () => {
    render(<McpCapabilityTree />);
    for (const category of MCP_CAPABILITY_CATEGORY_LABELS) {
      expect(screen.getByText(category.label)).toBeInTheDocument();
    }
  });

  it('counts each subject with the number of tools it has', () => {
    render(<McpCapabilityTree />);
    let total = 0;
    for (const category of MCP_CAPABILITY_CATEGORY_LABELS) {
      const count = MCP_CAPABILITIES.filter((c) => c.category === category.key).length;
      if (count === 0) continue;
      total += count;
      // The count sits on the subject's own row — several subjects share
      // the same count, so the query has to be scoped to the row.
      const node = screen.getByTestId(`mcp-tree-category-${category.key}`);
      expect(node.textContent).toContain(`${count} 个工具`);
    }
    // The subjects account for the whole catalogue — no tool is uncounted.
    expect(total).toBe(MCP_CAPABILITIES.length);
  });

  it('starts folded, so no tool name is on the screen yet', () => {
    render(<McpCapabilityTree />);
    for (const capability of MCP_CAPABILITIES) {
      expect(screen.queryByText(capability.name)).toBeNull();
    }
  });

  it('opens a subject and shows the tools under it', () => {
    render(<McpCapabilityTree />);
    const group = MCP_CAPABILITY_CATEGORY_LABELS.find(
      (c) => c.key === 'character' && MCP_CAPABILITIES.some((t) => t.category === c.key),
    );
    expect(group).toBeTruthy();

    fireEvent.click(screen.getByTestId(`mcp-tree-category-${group!.key}`));
    expect(screen.getByText('get_char')).toBeInTheDocument();
  });

  it('opens a tool and shows what it answers', () => {
    render(<McpCapabilityTree />);
    fireEvent.click(screen.getByTestId('mcp-tree-category-character'));
    fireEvent.click(screen.getByTestId('mcp-tree-tool-get_char'));

    const capability = MCP_CAPABILITIES.find((c) => c.name === 'get_char');
    expect(capability).toBeTruthy();
    expect(screen.getByText(capability!.summary)).toBeInTheDocument();
  });

  it('opens everything at once, and folds it back', () => {
    render(<McpCapabilityTree />);

    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));
    for (const capability of MCP_CAPABILITIES) {
      expect(screen.getByText(capability.name)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: '全部收起' }));
    for (const capability of MCP_CAPABILITIES) {
      expect(screen.queryByText(capability.name)).toBeNull();
    }
  });

  it('says that it is folded by default', () => {
    render(<McpCapabilityTree />);
    expect(screen.getByText(/默认折叠/)).toBeInTheDocument();
  });
});
