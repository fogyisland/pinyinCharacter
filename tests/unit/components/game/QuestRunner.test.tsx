// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installLocalStorageShim } from './helpers';
import type { QuestCharPayload, QuestLevelPayload } from '@/lib/game-quest-types';

/**
 * The quest runner - the flow engine of the 闯关 mode.
 *
 * The fixture's option shapes follow the real builder (Addendum H): ① offers
 * the toneless syllable, ② the four tone forms of the same syllable, ③ the
 * radical and ④ a meaning clause. The correct option is **not** always at
 * index 0, so a shuffle-blind implementation cannot pass.
 */
const mockState = vi.hoisted(() => ({
  speak: vi.fn(async (): Promise<void> => {}),
  muted: false,
}));

vi.mock('@/lib/tts', () => ({
  speak: mockState.speak,
  stopSpeaking: vi.fn(),
}));

vi.mock('@/lib/game-sound', () => ({
  playChime: vi.fn(),
  playThud: vi.fn(),
  playFanfare: vi.fn(),
  playStamp: vi.fn(),
  isSoundMuted: () => mockState.muted,
}));

vi.mock('@/lib/tts-cache', () => ({
  prefetchTts: vi.fn(async (): Promise<void> => {}),
}));

const CHAR_AI: QuestCharPayload = {
  char: '爱',
  pinyin: 'ài',
  plainPinyin: 'ai',
  tone: 4,
  toneName: '去声',
  radical: '爪',
  meaningZh: '对人或万物怀有深厚真挚的情谊',
  meaningShort: '怀有深厚真挚的情谊',
  hasStory: true,
  questions: [
    { kind: 'pinyin', options: ['ai', 'ao', 'an', 'ang'], answerIndex: 0 },
    { kind: 'tone', options: ['āi', 'ái', 'ǎi', 'ài'], answerIndex: 3 },
    { kind: 'radical', options: ['爪', '牙', '手', '心'], answerIndex: 0 },
    {
      kind: 'meaning',
      options: ['怀有深厚真挚的情谊', '走近并靠近', '用脚使劲踏', '把东西送给别人'],
      answerIndex: 0,
    },
  ],
};

const CHAR_HAO: QuestCharPayload = {
  char: '好',
  pinyin: 'hǎo',
  plainPinyin: 'hao',
  tone: 3,
  toneName: '上声',
  radical: '女',
  meaningZh: '优点多、令人满意',
  meaningShort: '令人满意',
  hasStory: false,
  questions: [
    { kind: 'pinyin', options: ['hao', 'he', 'huo', 'huan'], answerIndex: 0 },
    { kind: 'tone', options: ['hāo', 'háo', 'hǎo', 'hào'], answerIndex: 2 },
    { kind: 'radical', options: ['子', '女', '木', '心'], answerIndex: 1 },
    {
      kind: 'meaning',
      options: ['走近并靠近', '令人满意', '用脚使劲踏', '把东西送给别人'],
      answerIndex: 1,
    },
  ],
};

const CHAR_TIAN: QuestCharPayload = {
  char: '天',
  pinyin: 'tiān',
  plainPinyin: 'tian',
  tone: 1,
  toneName: '阴平',
  radical: '大',
  meaningZh: '头顶上的空间，一望无际',
  meaningShort: '头顶上的空间',
  hasStory: false,
  questions: [
    { kind: 'pinyin', options: ['tian', 'tiao', 'ting', 'tao'], answerIndex: 3 },
    { kind: 'tone', options: ['tiān', 'tián', 'tiǎn', 'tiàn'], answerIndex: 0 },
    { kind: 'radical', options: ['大', '人', '天', '夫'], answerIndex: 0 },
    {
      kind: 'meaning',
      options: ['头顶上的空间，一望无际', '走近并靠近', '用脚使劲踏', '把东西送给别人'],
      answerIndex: 0,
    },
  ],
};

const FIXTURE_CHARS = [CHAR_AI, CHAR_HAO, CHAR_TIAN];

function levelOf(chars: QuestCharPayload[]): QuestLevelPayload {
  return { hsk: 1, level: 1, levelCount: 31, tierSize: 150, skipped: 3, chars };
}

/** The mock returns the **envelope** - a bare payload would let a runner that forgets the unwrap pass. */
function mockLevelOk(payload: QuestLevelPayload): void {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, data: payload }),
  } as Response);
}

function promptOf(kind: string): Element | null {
  return document.querySelector(`[data-prompt="${kind}"]`);
}

function optionAt(index: number): HTMLElement {
  const wrapper = document.querySelector(`[data-option-index="${index}"]`);
  const button = wrapper?.querySelector('button');
  if (!button) throw new Error(`the option ${index} is not rendered`);
  return button as HTMLElement;
}

function optionIndexes(): number[] {
  return Array.from(document.querySelectorAll('[data-option-index]')).map((node) =>
    Number(node.getAttribute('data-option-index')),
  );
}

function advanceButton(): HTMLElement {
  const button = document.querySelector('[data-action="advance"]');
  if (!button) throw new Error('the advance button is not rendered');
  return button as HTMLElement;
}

function comboValue(): string | null {
  return document.querySelector('[data-combo]')?.getAttribute('data-combo') ?? null;
}

function pinyinFacet(): Element | null {
  return document.querySelector('[data-facet="pinyin"]');
}

/** Answer the current question of `char` correctly and move on. */
function answerCorrectly(char: QuestCharPayload, questionIndex: number): void {
  fireEvent.click(optionAt(char.questions[questionIndex].answerIndex));
  fireEvent.click(advanceButton());
}

/** The props the runner takes - every render has to wire all five. */
interface RunnerProps {
  onExit?: () => void;
  onPassed?: (level: number) => void;
  onNextLevel?: () => void;
}

async function renderRunner(
  payload: QuestLevelPayload,
  props: RunnerProps = {},
): Promise<HTMLElement> {
  mockLevelOk(payload);
  const { QuestRunner } = await import('@/components/game/quest/QuestRunner');
  const { container } = render(
    <QuestRunner
      tier={1}
      level={1}
      onExit={props.onExit ?? vi.fn()}
      onPassed={props.onPassed ?? vi.fn()}
      onNextLevel={props.onNextLevel ?? vi.fn()}
    />,
  );
  await waitFor(() => {
    expect(promptOf('pinyin')).not.toBeNull();
  });
  return container;
}

describe('QuestRunner — the quest flow', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    installLocalStorageShim();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockState.speak.mockReset();
    mockState.speak.mockImplementation(async (): Promise<void> => {});
    mockState.muted = false;
  });

  it('opens the level and asks the ① question first', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    expect(promptOf('pinyin')).not.toBeNull();
    expect(promptOf('tone')).toBeNull();
    // The pinyin facet is hidden while ① is pending.
    expect(pinyinFacet()).toBeNull();
  });

  it('reveals the correct answer and breaks the combo after a miss', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    // Answer ① correctly so the combo is not 0 by default.
    fireEvent.click(optionAt(0));
    expect(comboValue()).toBe('1');
    fireEvent.click(advanceButton());

    // ② is answered wrongly: the answer is revealed, the combo breaks.
    fireEvent.click(optionAt(0));
    expect(optionAt(3).dataset.state).toBe('revealed');
    expect(optionAt(0).dataset.state).toBe('wrong');
    expect(comboValue()).toBe('0');
  });

  it('locks the question and stamps the seal after a correct answer', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    fireEvent.click(optionAt(0));

    expect(optionAt(0)).toBeDisabled();
    expect(optionAt(1)).toBeDisabled();
    expect(document.querySelector('[data-seal]')).not.toBeNull();
  });

  it('removes exactly one wrong option when the hint is used', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    fireEvent.click(optionAt(0));
    fireEvent.click(advanceButton());

    const before = optionIndexes();
    fireEvent.click(screen.getByRole('button', { name: '提示' }));

    const after = optionIndexes();
    expect(after).toHaveLength(before.length - 1);
    const removed = before.find((index) => !after.includes(index));
    // The ② answer sits at the fixture's own index - the hint may never
    // remove it.
    expect(removed).not.toBe(CHAR_AI.questions[1].answerIndex);
    // The hint breaks the combo.
    expect(comboValue()).toBe('0');
  });

  it('keeps the pinyin hidden until ② is answered', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    expect(pinyinFacet()).toBeNull();

    fireEvent.click(optionAt(0));
    fireEvent.click(advanceButton());
    // ② is pending - the pinyin may not leak.
    expect(pinyinFacet()).toBeNull();

    fireEvent.click(optionAt(3));
    expect(pinyinFacet()).not.toBeNull();
  });

  it('does not leak ② through a wrong ① answer', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    fireEvent.click(optionAt(1));

    expect(pinyinFacet()).toBeNull();
    // The ① answer is visible in the question card itself.
    expect(optionAt(0).dataset.state).toBe('revealed');
    expect(promptOf('tone')).toBeNull();
  });

  it('hides the pinyin again in a remediation round that re-asks ①', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    // Miss ①, then answer the other three correctly.
    fireEvent.click(optionAt(1));
    fireEvent.click(advanceButton());
    answerCorrectly(CHAR_AI, 1);
    answerCorrectly(CHAR_AI, 2);
    answerCorrectly(CHAR_AI, 3);

    // The level is not passed - the summary offers the remediation.
    expect(screen.getByRole('button', { name: '重挑错字' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重挑错字' }));

    // The remediation re-asks ①, so the pinyin is hidden again.
    expect(promptOf('pinyin')).not.toBeNull();
    expect(pinyinFacet()).toBeNull();
  });

  it('reaches the summary on a one-char level', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    answerCorrectly(CHAR_AI, 0);
    answerCorrectly(CHAR_AI, 1);
    answerCorrectly(CHAR_AI, 2);
    answerCorrectly(CHAR_AI, 3);

    expect(screen.getByText('本关 1 字')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一关' })).toBeTruthy();
  });

  it('reaches the summary on a three-char level', async () => {
    await renderRunner(levelOf(FIXTURE_CHARS));

    for (const char of FIXTURE_CHARS) {
      answerCorrectly(char, 0);
      answerCorrectly(char, 1);
      answerCorrectly(char, 2);
      answerCorrectly(char, 3);
    }

    expect(screen.getByText('本关 3 字')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一关' })).toBeTruthy();
  });

  it('renders no 🔊 control on ① and one on ②', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    expect(screen.queryByRole('button', { name: /🔊/ })).toBeNull();

    fireEvent.click(optionAt(0));
    fireEvent.click(advanceButton());

    expect(screen.getByRole('button', { name: /🔊/ })).toBeTruthy();
  });

  it('keeps the question answerable when the audio fails', async () => {
    mockState.speak.mockImplementation(async (): Promise<void> => {
      throw new Error('the tts is down');
    });

    await renderRunner(levelOf([CHAR_AI]));

    fireEvent.click(optionAt(0));
    fireEvent.click(advanceButton());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '🔊 暂时不可用' })).toBeTruthy();
    });

    // The question is still answerable.
    fireEvent.click(optionAt(3));
    expect(optionAt(3).dataset.state).toBe('correct');
  });

  it('shows the error state and a retry button when the envelope is not ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: { code: 'level_not_found', message: '这一关不存在' },
      }),
    } as Response);
    const onExit = vi.fn();

    const { QuestRunner } = await import('@/components/game/quest/QuestRunner');
    render(
      <QuestRunner tier={1} level={99} onExit={onExit} onPassed={vi.fn()} onNextLevel={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('这一关不存在 —— 它可能已经随着字库更新而移走了')).toBeTruthy();
    });
    // A missing level is permanent for the running process - there is
    // nothing to retry, but there is always a way back.
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    expect(screen.getByRole('button', { name: '返回关卡地图' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '返回关卡地图' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('shows the error state when the HTTP status is not ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        ok: false,
        error: { code: 'level_not_found', message: '这一关不存在' },
      }),
    } as Response);
    const onExit = vi.fn();

    const { QuestRunner } = await import('@/components/game/quest/QuestRunner');
    render(
      <QuestRunner tier={1} level={99} onExit={onExit} onPassed={vi.fn()} onNextLevel={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('这一关不存在 —— 它可能已经随着字库更新而移走了')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    expect(screen.getByRole('button', { name: '返回关卡地图' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '返回关卡地图' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('offers a retry for a transient failure and re-issues the request', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        ok: false,
        error: { code: 'server', message: 'server error' },
      }),
    } as Response);
    const onExit = vi.fn();

    const { QuestRunner } = await import('@/components/game/quest/QuestRunner');
    render(
      <QuestRunner tier={1} level={99} onExit={onExit} onPassed={vi.fn()} onNextLevel={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('这一关暂时打不开')).toBeTruthy();
    });
    // A transient failure can be retried - and the way back is there too.
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回关卡地图' })).toBeTruthy();

    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('ends the attempt after a second failure', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    // Miss ①, then answer the other three correctly.
    fireEvent.click(optionAt(1));
    fireEvent.click(advanceButton());
    answerCorrectly(CHAR_AI, 1);
    answerCorrectly(CHAR_AI, 2);
    answerCorrectly(CHAR_AI, 3);

    // The first failure offers the remediation.
    fireEvent.click(screen.getByRole('button', { name: '重挑错字' }));

    // The remediation re-asks ① - fail it again and the attempt is over.
    fireEvent.click(optionAt(1));
    fireEvent.click(advanceButton());

    expect(screen.queryByRole('button', { name: '重挑错字' })).toBeNull();
    expect(screen.getByRole('button', { name: '返回关卡地图' })).toBeTruthy();
  });

  it('opens the next level from the summary', async () => {
    const onNextLevel = vi.fn();
    const onExit = vi.fn();
    await renderRunner(levelOf([CHAR_AI]), { onNextLevel, onExit });

    answerCorrectly(CHAR_AI, 0);
    answerCorrectly(CHAR_AI, 1);
    answerCorrectly(CHAR_AI, 2);
    answerCorrectly(CHAR_AI, 3);

    fireEvent.click(screen.getByRole('button', { name: '下一关' }));

    expect(onNextLevel).toHaveBeenCalledTimes(1);
    // 「下一关」 is not 「返回关卡地图」.
    expect(onExit).not.toHaveBeenCalled();
  });

  it('gives the audio up after 3 seconds and keeps the question answerable', async () => {
    mockState.speak.mockImplementation((): Promise<void> => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      mockLevelOk(levelOf([CHAR_AI]));
      const { QuestRunner } = await import('@/components/game/quest/QuestRunner');
      render(
        <QuestRunner
          tier={1}
          level={1}
          onExit={vi.fn()}
          onPassed={vi.fn()}
          onNextLevel={vi.fn()}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(promptOf('pinyin')).not.toBeNull();

      // ② plays the character - the request never settles.
      fireEvent.click(optionAt(0));
      fireEvent.click(advanceButton());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(screen.getByRole('button', { name: '🔊 暂时不可用' })).toBeTruthy();

      // The question is still answerable.
      fireEvent.click(optionAt(3));
      expect(optionAt(3).dataset.state).toBe('correct');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shakes the char card and marks the wrong option with a cross', async () => {
    const container = await renderRunner(levelOf([CHAR_AI]));

    fireEvent.click(optionAt(1));

    const card = container.querySelector('[data-wrong="true"]');
    expect(card).not.toBeNull();
    expect(card?.className).toContain('quest-shake');
    expect(card?.className).toContain('quest-card-wrong');
    expect(optionAt(1).textContent).toContain('✕');
  });

  it('renders one seal per char of the level', async () => {
    const container = await renderRunner(levelOf(FIXTURE_CHARS));

    expect(container.querySelectorAll('[data-seal-row]')).toHaveLength(3);
    // Nothing is 认会 yet.
    expect(container.querySelectorAll('[data-mastered="true"]')).toHaveLength(0);
  });

  it('keeps describing the level during a remediation round', async () => {
    const container = await renderRunner(levelOf(FIXTURE_CHARS));

    // Miss ① of the first char, answer everything else correctly.
    fireEvent.click(optionAt(1));
    fireEvent.click(advanceButton());
    answerCorrectly(CHAR_AI, 1);
    answerCorrectly(CHAR_AI, 2);
    answerCorrectly(CHAR_AI, 3);
    for (const char of [CHAR_HAO, CHAR_TIAN]) {
      answerCorrectly(char, 0);
      answerCorrectly(char, 1);
      answerCorrectly(char, 2);
      answerCorrectly(char, 3);
    }

    fireEvent.click(screen.getByRole('button', { name: '重挑错字' }));

    // The round holds the missed char alone - the level did not change, so
    // the header and the seal row still describe the level.
    expect(container.textContent).toContain('本关 3 字');
    expect(container.querySelectorAll('[data-seal-row]')).toHaveLength(3);
  });

  it('confirms the note with 记一笔 and keeps the jump to the book', async () => {
    await renderRunner(levelOf([CHAR_AI]));

    fireEvent.click(optionAt(1));
    expect(screen.queryByText('已记入生字本')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '记一笔' }));
    expect(screen.getByText('已记入生字本')).toBeTruthy();

    // The jump to the 生字本 is a separate link - the button only confirms.
    const link = document.querySelector('a[data-action="note"]');
    expect(link?.getAttribute('href')).toBe('/game?tab=wrong');
  });

  it('does not play the character when the sound is muted', async () => {
    mockState.muted = true;
    await renderRunner(levelOf([CHAR_AI]));

    fireEvent.click(optionAt(0));
    fireEvent.click(advanceButton());

    expect(mockState.speak).not.toHaveBeenCalled();
    // The question is still answerable.
    fireEvent.click(optionAt(3));
    expect(optionAt(3).dataset.state).toBe('correct');
  });
});
