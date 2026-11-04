// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { installLocalStorageShim } from './helpers';
import type { QuestCharPayload, QuestLevelPayload } from '@/lib/game-quest-types';

/**
 * The 朱红 seal that is stamped over the char card.
 *
 * The spec (§5.6) calls the seal **answer feedback**: "clicking the right
 * option locks the question and shows the seal". It is not a permanent
 * state of the character.
 *
 * Two defects are covered here:
 *
 *   A. The seal never goes away. `stampedChars[char]` is set on the first
 *      correct answer and is cleared only when the whole level is reloaded,
 *      so the seal sits over the glyph for every remaining question of that
 *      char — and for the rest of the level.
 *
 *   B. The seal's glyph IS the character 通. For the char 通 the seal reads
 *      通, so a red 通 covers the black 通 and the character looks like it
 *      was never revealed. The seal is `pointer-events-none` and
 *      `aria-hidden`, so nothing in the DOM says the char is hidden.
 *
 * The fixture uses 通 on purpose: it is the char that breaks.
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

/** The character whose glyph collides with the seal's glyph. */
const CHAR_TONG: QuestCharPayload = {
  char: '通',
  pinyin: 'tōng',
  plainPinyin: 'tong',
  tone: 1,
  toneName: '阴平',
  radical: '辶',
  meaningZh: '人或物可以到达或借此到达',
  meaningShort: '人或物可以到达',
  hasStory: false,
  questions: [
    { kind: 'pinyin', options: ['tong', 'tang', 'ting', 'teng'], answerIndex: 0 },
    { kind: 'tone', options: ['tōng', 'tóng', 'tǒng', 'tòng'], answerIndex: 0 },
    { kind: 'radical', options: ['辶', '讠', '扌', '忄'], answerIndex: 0 },
    {
      kind: 'meaning',
      options: [
        '人或物可以到达',
        '走进并靠近',
        '用脚使劲踏',
        '把东西送给别人',
      ],
      answerIndex: 0,
    },
  ],
};

function levelOf(chars: QuestCharPayload[]): QuestLevelPayload {
  return { hsk: 3, level: 1, levelCount: 31, tierSize: 150, skipped: 3, chars };
}

function mockLevelOk(payload: QuestLevelPayload): void {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, data: payload }),
  } as Response);
}

function optionAt(index: number): HTMLElement {
  const wrapper = document.querySelector(`[data-option-index="${index}"]`);
  const button = wrapper?.querySelector('button');
  if (!button) throw new Error(`the option ${index} is not rendered`);
  return button as HTMLElement;
}

function advanceButton(): HTMLElement {
  const button = document.querySelector('[data-action="advance"]');
  if (!button) throw new Error('the advance button is not rendered');
  return button as HTMLElement;
}

/** The seal that is stamped over the char card. */
function charCardSeal(): Element | null {
  return document.querySelector('[data-seal]');
}

/** The text of the seal that is stamped over the char card. */
function charCardSealText(): string | null {
  return charCardSeal()?.textContent ?? null;
}

/** The glyph the card shows. */
function charCardGlyph(): string | null {
  return document.querySelector('[data-char-glyph]')?.textContent ?? null;
}

interface RunnerProps {
  onExit?: () => void;
  onPassed?: (level: number) => void;
  onNextLevel?: () => void;
  muted?: boolean;
}

async function renderRunner(
  payload: QuestLevelPayload,
  props: RunnerProps = {},
): Promise<ReturnType<typeof render>> {
  mockLevelOk(payload);
  const { QuestRunner } = await import('@/components/game/quest/QuestRunner');
  const result = render(
    <QuestRunner
      tier={payload.hsk}
      level={payload.level}
      onExit={props.onExit ?? (() => {})}
      onPassed={props.onPassed ?? (() => {})}
      onNextLevel={props.onNextLevel ?? (() => {})}
      muted={props.muted ?? false}
    />,
  );
  await waitFor(() => {
    expect(document.querySelector('[data-option-index]')).not.toBeNull();
  });
  return result;
}

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

afterEach(() => {
  cleanup();
});

describe('the seal over the char card', () => {
  it('does not stay over the glyph for the next question of the same char', async () => {
    // The seal is answer feedback for the question that was just answered.
    // Once the learner moves on, it has done its job.
    await renderRunner(levelOf([CHAR_TONG]));

    // ① answered correctly → the seal stamps.
    fireEvent.click(optionAt(CHAR_TONG.questions[0].answerIndex));
    expect(charCardSeal()).not.toBeNull();

    // Move on to ②.
    fireEvent.click(advanceButton());

    await waitFor(() => {
      expect(charCardSeal()).toBeNull();
    });
  });

  it('does not stay over the glyph after the char card is left behind', async () => {
    // Advancing to the NEXT char must clear the previous char's seal too.
    // The seal row still carries a small 通 for a mastered char, but the big
    // stamp over the glyph is feedback for one question only.
    const charB: QuestCharPayload = {
      ...CHAR_TONG,
      char: '痛',
      pinyin: 'tòng',
      plainPinyin: 'tong',
      tone: 4,
      questions: [
        { kind: 'pinyin', options: ['tong', 'tang', 'ting', 'teng'], answerIndex: 0 },
        { kind: 'tone', options: ['tōng', 'tóng', 'tǒng', 'tòng'], answerIndex: 3 },
        { kind: 'radical', options: ['疒', '辶', '扌', '忄'], answerIndex: 0 },
        {
          kind: 'meaning',
          options: ['身体不舒服', '人或物可以到达', '用脚使劲踏', '把东西送给别人'],
          answerIndex: 0,
        },
      ],
    };
    await renderRunner(levelOf([CHAR_TONG, charB]));

    // Answer ① of the first char correctly.
    fireEvent.click(optionAt(CHAR_TONG.questions[0].answerIndex));
    expect(charCardSeal()).not.toBeNull();

    // Walk to the next char: answer each question, then advance.
    for (let question = 0; question < CHAR_TONG.questions.length; question += 1) {
      if (question > 0) {
        fireEvent.click(optionAt(CHAR_TONG.questions[question].answerIndex));
      }
      fireEvent.click(advanceButton());
    }

    await waitFor(() => {
      expect(charCardGlyph()).toBe('痛');
    });
    expect(charCardSeal()).toBeNull();
  });

  it('never prints the character 通 on top of the character 通', async () => {
    // The seal's own glyph was 通, so for the char 通 a red 通 covered the
    // black 通 and the character looked like it had never been revealed.
    await renderRunner(levelOf([CHAR_TONG]));

    fireEvent.click(optionAt(CHAR_TONG.questions[0].answerIndex));

    expect(charCardGlyph()).toBe('通');
    // The seal may be there — it is the correct-answer feedback — but it
    // must not bear the very character the card is teaching.
    expect(charCardSealText()).not.toBe('通');
  });

  it('stamps a check mark on the char card, not the 通 glyph', async () => {
    // The char card's seal is the answer feedback - a mark that says
    // "right". The 通 glyph is the mark of the 通关 screen and of the
    // level's seal row; on the card it collides with the character 通.
    await renderRunner(levelOf([CHAR_TONG]));

    fireEvent.click(optionAt(CHAR_TONG.questions[0].answerIndex));

    expect(charCardSealText()).toBe('✓');
  });

  it('keeps the 通 glyph on the 通关 screen', async () => {
    // The 通关 screen has no character on it, so the big seal keeps its 通 -
    // that is the mark of the level being passed.
    const { QuestSummary } = await import('@/components/game/quest/QuestSummary');
    render(
      <QuestSummary
        tier={3}
        level={1}
        chars={[CHAR_TONG]}
        missed={[]}
        passed
        onNext={() => {}}
        onExit={() => {}}
      />,
    );

    const seal = document.querySelector('[data-seal]');
    expect(seal).not.toBeNull();
    expect(seal?.textContent).toBe('通');
  });
});
