import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * The classics tools must never read a file outside `data/classics`.
 *
 * A slug is turned into a file path (`data/classics/<slug>.json`), and
 * `path.join` normalises `..` segments — so a slug like `../../package`
 * used to read `package.json` from the repository root. The endpoint is
 * public (any registered user can get an MCP token), so the slug is now
 * constrained twice: in the tool's schema and in the loader itself.
 *
 * The proof is not the error code: it is that no file outside the classics
 * directory is even looked for. The loader reads the books through
 * `lib/json-fs.ts`, so mocking that module records every path a slug turned
 * into.
 */

const { readPaths } = vi.hoisted(() => ({ readPaths: [] as string[] }));

vi.mock('@/lib/json-fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/json-fs')>();
  return {
    ...actual,
    readJsonAuto: (file: string) => {
      readPaths.push(file);
      return actual.readJsonAuto(file);
    },
  };
});

import { connectTestClient, toolData } from './route-harness';
import { loadClassicFile } from '@/lib/classics/loader';
import { requireClassicSlug } from '@/mcp/tools/shared';

/** The directory the classic books live in. */
const CLASSICS_DIR = path.resolve(process.cwd(), 'data', 'classics');

/** The text of a tool result, whatever it holds. */
function resultText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.find((entry) => entry.type === 'text')?.text ?? '';
}

/** Is the path inside the classics directory? */
function isInsideClassics(file: string): boolean {
  const resolved = path.resolve(file);
  return resolved.startsWith(CLASSICS_DIR + path.sep);
}

/** The paths that were read outside the classics directory. */
function readsOutsideClassics(): string[] {
  return readPaths.filter((file) => !isInsideClassics(file));
}

describe('the classics tools: a slug may not leave the classics directory', () => {
  it('refuses a slug that points at the repository root', async () => {
    const { client, close } = await connectTestClient();
    try {
      readPaths.length = 0;
      const result = await client.callTool({
        name: 'get_classic_outline',
        arguments: { slug: '../../package' },
      });

      // The schema refuses the slug before the tool body runs, so the answer
      // names the rule instead of reading a file.
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(resultText(result)).toMatch(/slug/i);
      expect(resultText(result)).not.toMatch(/internal_error/);
      // No file outside data/classics was read — not even looked for.
      expect(readsOutsideClassics()).toEqual([]);
      expect(readPaths).toEqual([]);
    } finally {
      await close();
    }
  });

  it('refuses a slug that points at the classics manifest', async () => {
    const { client, close } = await connectTestClient();
    try {
      readPaths.length = 0;
      const result = await client.callTool({
        name: 'get_classic_outline',
        arguments: { slug: '../classics-manifest' },
      });

      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(resultText(result)).toMatch(/slug/i);
      expect(readsOutsideClassics()).toEqual([]);
    } finally {
      await close();
    }
  });

  it('refuses a traversal slug on the chapter tool as well', async () => {
    const { client, close } = await connectTestClient();
    try {
      readPaths.length = 0;
      const result = await client.callTool({
        name: 'get_classic_chapter',
        arguments: { slug: '../../package', chapter: 1 },
      });

      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(resultText(result)).toMatch(/slug/i);
      expect(readsOutsideClassics()).toEqual([]);
    } finally {
      await close();
    }
  });

  it('still reads a real book', async () => {
    const { client, close } = await connectTestClient();
    try {
      readPaths.length = 0;
      const data = toolData(
        await client.callTool({ name: 'get_classic_outline', arguments: { slug: 'chuci' } }),
      );
      expect(typeof data.title).toBe('string');
      expect((data.title as string).length).toBeGreaterThan(0);
      expect(data.slug).toBe('chuci');
      // The book came from the classics directory.
      expect(readsOutsideClassics()).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe('the classics loader: the containment is the loader\'s own', () => {
  it('reads a book from the classics directory', async () => {
    readPaths.length = 0;
    const book = await loadClassicFile('baijiaxing');
    expect(book).not.toBeNull();
    expect(book?.title).toBe('百家姓');
    // The recorder works: the book was read, and from where it belongs.
    expect(readPaths.length).toBeGreaterThan(0);
    expect(readsOutsideClassics()).toEqual([]);
  });

  it('refuses a traversal slug without looking for the file', async () => {
    readPaths.length = 0;
    // Before the fix this read `package.json` from the repository root.
    await expect(loadClassicFile('../../package')).rejects.toThrow(
      /points outside the classics directory/,
    );
    // The file was never even looked for.
    expect(readPaths).toEqual([]);
  });

  it('refuses a traversal slug that points at the classics manifest', async () => {
    readPaths.length = 0;
    await expect(loadClassicFile('../classics-manifest')).rejects.toThrow(
      /points outside the classics directory/,
    );
    expect(readPaths).toEqual([]);
  });
});

describe('the slug guard of the tool bodies', () => {
  it('answers a bad slug with the site\'s bad_input envelope', () => {
    let caught: unknown;
    try {
      requireClassicSlug('../../package');
    } catch (error) {
      caught = error;
    }
    const error = caught as { code?: string; message?: string; details?: Record<string, unknown> };
    expect(error.code).toBe('bad_input');
    expect(error.message).toMatch(/lowercase letters, digits and dashes/);
    expect(error.details?.argument).toBe('slug');
  });

  it('lets a real slug through', () => {
    expect(requireClassicSlug('baijiaxing')).toBe('baijiaxing');
  });
});
