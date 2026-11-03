// @vitest-environment happy-dom
/**
 * The error text of a failed round and of a failed quest level.
 *
 * 2026-11-03: the learner was shown the API's error code verbatim
 * ("fetchGameRound failed: no_chars") and the quest error said "这一关不存在
 * —— 它可能已经随着字库更新而移走了", which sent the reader after a content
 * change that was not the problem. The real cause was that the HSK grading
 * was never imported on the server.
 *
 * The codes now map to sentences, and the sentence names the administrator
 * when the remedy is a command on the server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { installLocalStorageShim } from './helpers';

const mockState = vi.hoisted(() => ({
  hskLevel: 1 as number,
  difficulty: 'medium' as const,
}));

vi.mock('@/lib/use-difficulty', () => ({
  useDifficulty: () => ({
    difficulty: 'medium',
    hskLevel: mockState.hskLevel,
    setDifficulty: vi.fn(),
    setHskLevel: vi.fn(),
    ready: true,
  }),
}));

/** The envelope of a failed round. */
function mockFetchError(code: string) {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({ ok: false, error: { code, message: 'server said no' } }),
  } as Response);
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
  installLocalStorageShim();
});

describe('the round error text', () => {
  it('names the administrator when the HSK grading was never imported', async () => {
    const { roundErrorText } = await import('@/components/game/round-error');
    const text = roundErrorText('hsk_level_not_imported');
    expect(text).toContain('管理员');
    expect(text).toContain('HSK');
  });

  it('gives the command that fixes it', async () => {
    const { roundErrorRemedy } = await import('@/components/game/round-error');
    expect(roundErrorRemedy('hsk_level_not_imported')).toContain('import-hsk.ts');
  });

  it('offers no command for a plain shortage — there is nothing to run', async () => {
    const { roundErrorRemedy } = await import('@/components/game/round-error');
    expect(roundErrorRemedy('no_chars')).toBeNull();
  });

  it('never shows the raw code to the learner', async () => {
    const { roundErrorText } = await import('@/components/game/round-error');
    for (const code of ['hsk_level_not_imported', 'no_chars', 'bad_input', 'unknown']) {
      expect(roundErrorText(code)).not.toContain(code);
    }
  });
});

describe('ToneRadicalGame — a failed round', () => {
  it('shows a Chinese sentence, not the API code', async () => {
    mockFetchError('hsk_level_not_imported');
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    render(<ToneRadicalGame />);
    await waitFor(() => expect(screen.getByText(/管理员/)).toBeTruthy());
    expect(screen.queryByText(/hsk_level_not_imported/)).toBeNull();
    expect(screen.queryByText(/fetchGameRound failed/)).toBeNull();
  });

  it('shows the command that fixes it', async () => {
    mockFetchError('hsk_level_not_imported');
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    render(<ToneRadicalGame />);
    await waitFor(() => expect(screen.getByText(/import-hsk\.ts/)).toBeTruthy());
  });

  it('does not show a command for a plain shortage', async () => {
    mockFetchError('no_chars');
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    render(<ToneRadicalGame />);
    await waitFor(() => expect(screen.getByText(/出错了/)).toBeTruthy());
    expect(screen.queryByText(/import-hsk\.ts/)).toBeNull();
  });
});

describe('QuestErrorState — a missing tier', () => {
  it('does not blame a content change', async () => {
    const { HSK_TIER_MISSING } = await import('@/components/game/quest/QuestErrorState');
    expect(HSK_TIER_MISSING.message).not.toContain('移走');
    expect(HSK_TIER_MISSING.message).toContain('管理员');
  });

  it('cannot be retried into existence', async () => {
    const { HSK_TIER_MISSING } = await import('@/components/game/quest/QuestErrorState');
    // The tier is built once per process and the import needs a command on
    // the server, so a retry button would only ever fail again.
    expect(HSK_TIER_MISSING.canRetry).toBe(false);
  });
});
