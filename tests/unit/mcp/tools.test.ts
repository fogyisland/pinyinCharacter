import { describe, expect, it } from 'vitest';
import { connectTestClient, toolData } from './harness';

/**
 * The MCP tools' payloads.
 *
 * Every case drives a real tool over the real transport and reads the
 * payload the client receives.
 */

/** The text of a tool result, whatever it holds. */
function resultText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.find((entry) => entry.type === 'text')?.text ?? '';
}

/** The parsed envelope of a tool result. */
function envelope(result: unknown): { ok: boolean; data?: unknown; error?: { code: string } } {
  return JSON.parse(resultText(result)) as {
    ok: boolean;
    data?: unknown;
    error?: { code: string };
  };
}

describe('the char tools', () => {
  it('reads a character out of the character library', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(await client.callTool({ name: 'get_char', arguments: { char: '爱' } }));
      expect(data.char).toBe('爱');
      expect(data.pinyin).toBe('ài');
      expect(typeof data.meaningZh).toBe('string');
      expect((data.meaningZh as string).length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('answers a character the library does not hold', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({ name: 'get_char', arguments: { char: '龦' } });
      expect(envelope(result).ok).toBe(false);
      expect(envelope(result).error?.code).toBe('not_found');
    } finally {
      await close();
    }
  });

  it('refuses a char that is not a Han character', async () => {
    const { client, close } = await connectTestClient();
    try {
      // ".." is short enough for the schema, so it reaches the tool body —
      // which is where the path-traversal guard lives.
      const result = await client.callTool({ name: 'get_char', arguments: { char: '..' } });
      expect(envelope(result).ok).toBe(false);
      expect(envelope(result).error?.code).toBe('bad_input');
    } finally {
      await close();
    }
  });

  it('rejects an argument the schema refuses', async () => {
    const { client, close } = await connectTestClient();
    try {
      // Too long for the schema, so the server refuses the call before the
      // tool body ever runs.
      const result = await client.callTool({
        name: 'get_char',
        arguments: { char: '../etc' },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(resultText(result)).toMatch(/Invalid arguments/);
    } finally {
      await close();
    }
  });

  it('reads the radical of a character', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(await client.callTool({ name: 'get_radical', arguments: { char: '树' } }));
      expect(data.char).toBe('树');
      expect(data.radical).toBe('木');
      expect(data.known).toBe(true);
    } finally {
      await close();
    }
  });

  it('reads the stroke count of a character', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({ name: 'get_stroke_count', arguments: { char: '七' } }),
      );
      expect(data.strokeCount).toBe(2);
      expect(data.known).toBe(true);
    } finally {
      await close();
    }
  });

  it('reads the four tone forms of a character', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({ name: 'get_tone_forms', arguments: { char: '爱' } }),
      );
      expect(data.reading).toBe('ài');
      expect(data.plainSyllable).toBe('ai');
      expect(data.toneForms).toEqual(['āi', 'ái', 'ǎi', 'ài']);
    } finally {
      await close();
    }
  });
});

describe('the pinyin tools', () => {
  it('finds the characters of a syllable', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({ name: 'pinyin_to_hanzi', arguments: { pinyin: 'ai4' } }),
      );
      expect(data.total).toBeGreaterThan(0);
      const candidates = data.candidates as { char: string }[];
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.some((entry) => entry.char === '爱')).toBe(true);
    } finally {
      await close();
    }
  });

  it('spells a sentence out of pinyin', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({ name: 'pinyin_to_sentence', arguments: { pinyin: 'ni hao' } }),
      );
      expect(typeof data.sentence).toBe('string');
      expect((data.sentence as string).length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('reads a piece of text out in pinyin', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({ name: 'text_to_pinyin', arguments: { text: '我爱汉字' } }),
      );
      const characters = data.characters as { char: string; pinyin: string | null }[];
      expect(characters).toHaveLength(4);
      expect(characters[0]).toEqual({ char: '我', pinyin: 'wǒ', plain: 'wo' });
      expect(characters[3]?.pinyin).toBe('zì');
    } finally {
      await close();
    }
  });
});

describe('the quest tools', () => {
  it('builds a level of the quest', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({ name: 'build_quest_level', arguments: { hsk: 1, level: 1 } }),
      );
      const chars = data.chars as { char: string; questions: unknown[] }[];
      expect(chars.length).toBe(5);
      for (const char of chars) {
        expect(char.questions).toHaveLength(4);
      }
      expect(data.levelCount).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('answers a level beyond the tier', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'build_quest_level',
        arguments: { hsk: 1, level: 9999 },
      });
      expect(envelope(result).ok).toBe(false);
      expect(envelope(result).error?.code).toBe('not_found');
    } finally {
      await close();
    }
  });

  it('works out which facets may be shown', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({
          name: 'reveal_facets',
          arguments: {
            kind: 'main',
            charIndex: 0,
            questionIndex: 0,
            questionIndices: [[0, 1, 2, 3]],
            answeredCounts: [0],
          },
        }),
      );
      // The pinyin is tested by the first two questions, so it stays hidden.
      expect(data.showPinyin).toBe(false);
      expect(data.showRadical).toBe(false);
      expect(data.showMeaning).toBe(false);
    } finally {
      await close();
    }
  });
});

describe('the worksheet tool', () => {
  it('lays a worksheet out', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(
        await client.callTool({
          name: 'generate_worksheet_layout',
          arguments: { content: '天地玄黄', cellStyle: 'pen-square', paperSize: 'A4' },
        }),
      );
      expect(data.cellStyle).toBe('pen-square');
      expect(data.paperSize).toBe('A4');
      const cells = data.cells as { char: string }[];
      expect(cells.length).toBeGreaterThanOrEqual(4);
      expect(cells[0]?.char).toBe('天');
    } finally {
      await close();
    }
  });

  it('refuses a cell style it does not know', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'generate_worksheet_layout',
        arguments: { content: '天', cellStyle: 'pen-triangle' },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(resultText(result)).toMatch(/Invalid arguments/);
    } finally {
      await close();
    }
  });

  it('refuses content that is not a Han character', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: 'generate_worksheet_layout',
        arguments: { content: 'abc', cellStyle: 'pen-square' },
      });
      expect(envelope(result).ok).toBe(false);
      expect(envelope(result).error?.code).toBe('bad_input');
    } finally {
      await close();
    }
  });
});

describe('the literature tools', () => {
  it('lists the poems', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(await client.callTool({ name: 'list_poems', arguments: {} }));
      expect(data.total).toBeGreaterThan(0);
      const items = data.items as { id: number; title: string }[];
      expect(items.length).toBeGreaterThan(0);
      expect(typeof items[0]?.title).toBe('string');
    } finally {
      await close();
    }
  });

  it('reads one poem', async () => {
    const { client, close } = await connectTestClient();
    try {
      const listed = toolData(await client.callTool({ name: 'list_poems', arguments: {} }));
      const items = listed.items as { id: number }[];
      const id = items[0]!.id;
      const data = toolData(await client.callTool({ name: 'get_poem', arguments: { id } }));
      expect(data.id).toBe(id);
      expect(Array.isArray(data.content)).toBe(true);
    } finally {
      await close();
    }
  });

  it('answers a poem that does not exist', async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({ name: 'get_poem', arguments: { id: 99999999 } });
      expect(envelope(result).ok).toBe(false);
      expect(envelope(result).error?.code).toBe('not_found');
    } finally {
      await close();
    }
  });

  it('lists the scriptures', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(await client.callTool({ name: 'list_sutras', arguments: {} }));
      expect(data.total).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('reads the chapter list of a scripture', async () => {
    const { client, close } = await connectTestClient();
    try {
      const listed = toolData(await client.callTool({ name: 'list_sutras', arguments: {} }));
      const items = listed.items as { id: number }[];
      const data = toolData(
        await client.callTool({ name: 'get_sutra_chunk', arguments: { id: items[0]!.id } }),
      );
      expect(data.chunkCount).toBeGreaterThan(0);
      const chunks = data.chunks as { label: string }[];
      expect(typeof chunks[0]?.label).toBe('string');
    } finally {
      await close();
    }
  });

  it('lists the classical books', async () => {
    const { client, close } = await connectTestClient();
    try {
      const data = toolData(await client.callTool({ name: 'list_classics', arguments: {} }));
      expect(data.total).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('reads the outline of a classical book', async () => {
    const { client, close } = await connectTestClient();
    try {
      const listed = toolData(await client.callTool({ name: 'list_classics', arguments: {} }));
      const items = listed.items as { slug: string }[];
      const data = toolData(
        await client.callTool({ name: 'get_classic_outline', arguments: { slug: items[0]!.slug } }),
      );
      expect(data.chunkCount).toBeGreaterThan(0);
      const chunks = data.chunks as { id: number; label: string }[];
      expect(typeof chunks[0]?.label).toBe('string');
    } finally {
      await close();
    }
  });

  it('reads one chapter of a classical book', async () => {
    const { client, close } = await connectTestClient();
    try {
      const listed = toolData(await client.callTool({ name: 'list_classics', arguments: {} }));
      const items = listed.items as { slug: string }[];
      const data = toolData(
        await client.callTool({
          name: 'get_classic_chapter',
          arguments: { slug: items[0]!.slug, chapter: 1 },
        }),
      );
      const chapter = data.chapter as { content: string[] };
      expect(Array.isArray(chapter.content)).toBe(true);
      expect(chapter.content.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});
