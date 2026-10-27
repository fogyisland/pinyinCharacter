import { describe, expect, it, vi } from 'vitest';

// The renderer must never read the site's url from the database: the tools
// stay file-only, and only the auth path talks to MySQL (spec §"Non-goals").
// The site's own printable worksheet reads the host from the environment —
// this mock makes a regression loud instead of silent.
vi.mock('@/lib/seo/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo/config')>();
  return {
    ...actual,
    getRuntimeSiteUrl: async () => {
      throw new Error('the worksheet renderer must not read the site url from the database');
    },
  };
});

import { connectTestClient, toolData } from './route-harness';
import { getTool, type CellStyle } from '@/lib/worksheet-types';

/**
 * The two worksheet tools of the catalogue and the renderer.
 *
 * The scheme catalogue is data, so it is asserted on its own terms. The
 * renderer is asserted on the wire: the page comes back as an image block,
 * the metadata says how big the sheet is, and a request that cannot be
 * rendered answers with the site's error envelope and no image at all.
 */

/** The content blocks of a tool result. */
function blocks(result: unknown): { type: string; text?: string; data?: string; mimeType?: string }[] {
  return (result as { content?: { type: string; text?: string; data?: string; mimeType?: string }[] })
    .content ?? [];
}

/** The parsed envelope of a tool result. */
function envelope(result: unknown): {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
} {
  const text = blocks(result).find((entry) => entry.type === 'text')?.text ?? '';
  return JSON.parse(text) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
}

/** The image block of a tool result, if it carries one. */
function imageBlock(result: unknown): { type: string; data?: string; mimeType?: string } | undefined {
  return blocks(result).find((entry) => entry.type === 'image');
}

describe('the worksheet scheme catalogue', () => {
  it('lists every scheme with the labels of its cell style and paper size', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(await client.callTool({ name: 'list_worksheet_schemes', arguments: {} }));
      const schemes = data.schemes as {
        id: string;
        cellStyleLabel: string;
        paperSizeLabel: string;
      }[];
      expect(schemes.length).toBe(16);
      for (const scheme of schemes) {
        expect(typeof scheme.id, 'a scheme without an id').toBe('string');
        expect(typeof scheme.cellStyleLabel).toBe('string');
        expect(scheme.cellStyleLabel.length).toBeGreaterThan(0);
        expect(typeof scheme.paperSizeLabel).toBe('string');
        expect(scheme.paperSizeLabel.length).toBeGreaterThan(0);
      }
    } finally {
      await close();
    }
  });

  it('narrows the catalogue to the brush schemes', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({ name: 'list_worksheet_schemes', arguments: { tool: 'brush' } }),
      );
      const schemes = data.schemes as { cellStyle: CellStyle }[];
      expect(schemes.length).toBeGreaterThan(0);
      expect(schemes.length).toBeLessThan(16);
      for (const scheme of schemes) {
        expect(getTool(scheme.cellStyle)).toBe('brush');
      }
    } finally {
      await close();
    }
  });
});

describe('the worksheet PNG renderer', () => {
  it('renders a page and answers with an image block', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'render_worksheet_png',
        arguments: { content: '天地玄黄', scheme: 'pen-grid-a4' },
      });

      const image = imageBlock(result);
      expect(image, 'no image block in the result').toBeTruthy();
      expect(image?.mimeType).toBe('image/png');
      expect((image?.data?.length ?? 0)).toBeGreaterThan(0);

      const payload = envelope(result);
      expect(payload.ok).toBe(true);
      expect(payload.data?.width).toBe(794);
      expect(payload.data?.height).toBe(1123);
      expect(payload.data?.totalPages).toBe(1);
      expect(payload.data?.base64Length as number).toBeGreaterThan(0);
      expect(payload.data?.bytes as number).toBeGreaterThan(0);
      expect(payload.data?.scheme).toBe('pen-grid-a4');
    } finally {
      await close();
    }
  });

  it('refuses content that is not a Han character and renders no image', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'render_worksheet_png',
        arguments: { content: 'abc', cellStyle: 'pen-square' },
      });

      expect((result as { isError?: boolean }).isError).toBe(true);
      const payload = envelope(result);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe('bad_input');
      // The envelope is the answer — and nothing was rendered.
      expect(imageBlock(result)).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('answers a scheme the catalogue does not hold', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'render_worksheet_png',
        arguments: { content: '天地玄黄', scheme: 'no-such-scheme' },
      });

      const payload = envelope(result);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe('not_found');
      expect(payload.error?.details?.id).toBe('no-such-scheme');
      expect(payload.error?.details?.scheme).toBe('no-such-scheme');
    } finally {
      await close();
    }
  });

  it('refuses a page that is beyond the sheet', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'render_worksheet_png',
        arguments: { content: '天地玄黄', scheme: 'pen-grid-a4', page: 99 },
      });

      const payload = envelope(result);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe('bad_input');
      expect(imageBlock(result)).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('refuses a page below the first one', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'render_worksheet_png',
        arguments: { content: '天地玄黄', scheme: 'pen-grid-a4', page: 0 },
      });

      const payload = envelope(result);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe('bad_input');
      expect(imageBlock(result)).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('keeps the lined paper on a single page', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({
          name: 'render_worksheet_png',
          arguments: { content: '天地玄黄', scheme: 'pen-lined-a4' },
        }),
      );
      // The lined paper is blank ruled paper — it is always one page. Counting
      // the cells of the grid instead would answer four.
      expect(data.totalPages).toBe(1);
      expect(data.page).toBe(1);
    } finally {
      await close();
    }
  });

  it('reports the characters no font can draw', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({
          name: 'render_worksheet_png',
          arguments: { content: '一丂', scheme: 'pen-grid-a4' },
        }),
      );
      const missing = data.missingGlyphs as string[];
      expect(missing).toContain('丂');
      expect(missing).not.toContain('一');
    } finally {
      await close();
    }
  });

  it('refuses the lined paper on a brush paper', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'render_worksheet_png',
        arguments: { content: '天地玄黄', cellStyle: 'pen-lined', paperSize: 'brush-12' },
      });

      const payload = envelope(result);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe('bad_input');
      // The sheet would carry a header and a footer and nothing else.
      expect(imageBlock(result)).toBeUndefined();
    } finally {
      await close();
    }
  });
});
