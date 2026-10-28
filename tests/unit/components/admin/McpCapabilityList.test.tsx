// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { McpCapabilityList } from '@/components/admin/mcp/McpCapabilityList';
import {
  MCP_CAPABILITIES,
  MCP_CAPABILITY_CATEGORY_LABELS,
} from '@/mcp/capabilities';

/**
 * The capability catalogue on the admin's MCP page.
 *
 * The user asked for the MCP service's capabilities to be *listed*, and
 * then for the list to be visible rather than buried at the bottom of
 * the page. The subjects are therefore always on screen, with their
 * counts, and the twenty entries themselves sit behind a disclosure.
 *
 * The counts are the part that can go stale, so they are pinned here:
 * a subject's count must be the number of tools it actually has, and
 * the counts must add up to the whole catalogue.
 *
 * The queries are scoped to the chip row: a subject's name appears
 * twice in the document — once as a chip, once as the heading of its
 * group — and only the chip carries the count.
 */

afterEach(() => {
  cleanup();
});

/** The chip row of the catalogue. */
function chips() {
  return within(screen.getByTestId('mcp-capability-chips'));
}

describe('McpCapabilityList', () => {
  it('names every subject the catalogue has', () => {
    render(<McpCapabilityList />);
    for (const category of MCP_CAPABILITY_CATEGORY_LABELS) {
      expect(chips().getByText(category.label)).toBeInTheDocument();
    }
  });

  it('counts each subject with the number of tools it has', () => {
    render(<McpCapabilityList />);
    let total = 0;
    for (const category of MCP_CAPABILITY_CATEGORY_LABELS) {
      const count = MCP_CAPABILITIES.filter((c) => c.category === category.key).length;
      if (count === 0) continue;
      total += count;
      // The count sits next to the subject's name.
      const label = chips().getByText(category.label);
      expect(label.parentElement?.textContent).toContain(String(count));
    }
    // The chips account for the whole catalogue — no tool is uncounted.
    expect(total).toBe(MCP_CAPABILITIES.length);
  });

  it('offers the whole catalogue behind one disclosure', () => {
    render(<McpCapabilityList />);
    expect(
      screen.getByText(`展开全部 ${MCP_CAPABILITIES.length} 个工具的名字与用途`),
    ).toBeInTheDocument();
  });

  it('shows every tool by its name', () => {
    render(<McpCapabilityList />);
    for (const capability of MCP_CAPABILITIES) {
      expect(screen.getByText(capability.name)).toBeInTheDocument();
      expect(screen.getByText(capability.summary)).toBeInTheDocument();
    }
  });
});
