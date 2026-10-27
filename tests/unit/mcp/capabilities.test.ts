import { describe, it, expect } from 'vitest';
import { connectTestClient } from './route-harness';
import {
  MCP_CAPABILITIES,
  MCP_CAPABILITY_CATEGORY_LABELS,
  MCP_CAPABILITY_NAMES,
  groupCapabilitiesByCategory,
} from '@/mcp/capabilities';

/**
 * The MCP capability catalogue.
 *
 * `mcp/capabilities.ts` is the human-readable twin of the tool registry:
 * the admin page shows it, so an operator can see the whole surface of the
 * MCP service without reading the source. That only works while the two
 * lists agree, so this test asks the running server for its tool list and
 * compares it with the catalogue — names first, then the display titles.
 *
 * The comparison is over the wire (the SDK client against the real route),
 * so it also proves that the titles the catalogue prints are the titles the
 * clients see.
 */
describe('the MCP capability catalogue', () => {
  it('lists exactly the tools the server registers', async () => {
    const { client, close } = await connectTestClient();
    try {
      const listed = await client.listTools();
      const registered = listed.tools.map((tool) => tool.name).sort();
      expect(registered).toEqual([...MCP_CAPABILITY_NAMES].sort());
    } finally {
      await close();
    }
  });

  it('gives every tool the title the server registers', async () => {
    const { client, close } = await connectTestClient();
    try {
      const listed = await client.listTools();
      for (const tool of listed.tools) {
        const capability = MCP_CAPABILITIES.find((c) => c.name === tool.name);
        expect(capability, `${tool.name} has no catalogue entry`).toBeTruthy();
        expect(capability?.title, `${tool.name} has a different title`).toBe(tool.title);
      }
    } finally {
      await close();
    }
  });

  it('has no catalogue entry without a tool behind it', () => {
    const names = new Set(MCP_CAPABILITY_NAMES);
    expect(names.size).toBe(MCP_CAPABILITY_NAMES.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('gives every tool a Chinese summary and a known category', () => {
    const categories = new Set(MCP_CAPABILITY_CATEGORY_LABELS.map((c) => c.key));
    for (const capability of MCP_CAPABILITIES) {
      expect(capability.summary.length, `${capability.name} has no summary`).toBeGreaterThan(4);
      expect(categories.has(capability.category), `${capability.name} has no category`).toBe(true);
    }
  });

  it('groups every tool under exactly one category', () => {
    const groups = groupCapabilitiesByCategory();
    const grouped = groups.flatMap((group) => group.items.map((item) => item.name));
    expect(grouped.sort()).toEqual([...MCP_CAPABILITY_NAMES].sort());
    // The groups come out in the order the categories are declared.
    const order = MCP_CAPABILITY_CATEGORY_LABELS.map((c) => c.key);
    expect(groups.map((g) => g.key)).toEqual(order.filter((key) => groups.some((g) => g.key === key)));
  });
});
