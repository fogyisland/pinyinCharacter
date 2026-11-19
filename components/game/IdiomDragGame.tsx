'use client';

/**
 * 成语拖字 — the idiom drag game.
 *
 * An idiom is shown with some of its characters blanked out, and a tray of
 * candidate characters sits above it. The player drags the right character
 * into each blank.
 *
 * The RULES live in `lib/idiom-rules.ts` — which slots start blank, what
 * the tray holds, which drops are refused and how the round is won. This
 * file is the rendering: the tray, the answer area, the drag handlers and
 * the round lifecycle.
 *
 * The drag is implemented with the HTML drag-and-drop API rather than with
 * pointer events. That is a deliberate choice: the HTML API gives the
 * browser's own drag image, keyboard fallback is not needed because every
 * tile is also a button that can be clicked into the selected blank, and
 * there is no rAF loop to keep alive. The click-to-select path is the one
 * a keyboard user and a touch-screen user both need, and it is the same
 * code path — a click sets the selected tile, a second click on a slot
 * drops it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchIdioms } from '@/lib/api-idioms';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { playChime, playFanfare, playThud } from '@/lib/game-sound';
import {
  IDIOM_CONFIG,
  buildRound,
  charactersOf,
  dropCharacter,
  liftCharacter,
  isRoundWon,
  blanksRemaining,
  type GameIdiom,
  type IdiomRound,
} from '@/lib/idiom-rules';
import type { Difficulty } from '@/lib/difficulty';

type Phase = 'loading' | 'ready' | 'playing' | 'won' | 'error';

/** What the component remembers between rounds. */
interface GameState {
  phase: Phase;
  /** The idioms the game draws from. */
  pool: GameIdiom[];
  /** The round being played. */
  round: IdiomRound | null;
  /** The tray tile the player picked up, if any. */
  selectedTrayId: string | null;
  /** The message shown under the answer area. */
  message: string;
  /** How many rounds the player has solved. */
  solved: number;
  /** The message the server produced when the query failed. */
  error: string;
  /** The seed of the round being played. It advances on every round. */
  seed: number;
}

/** The state before anything is loaded. */
const INITIAL: GameState = {
  phase: 'loading',
  pool: [],
  round: null,
  selectedTrayId: null,
  message: '',
  solved: 0,
  error: '',
  seed: 0,
};

/** The state when the game is on its start card. */
const READY: GameState = {
  phase: 'ready',
  pool: [],
  round: null,
  selectedTrayId: null,
  message: '',
  solved: 0,
  error: '',
  seed: 0,
};

/** The reason a drop was refused, in the words the player reads. */
const REFUSAL_TEXT: Record<string, string> = {
  wrong_character: '这个字放错了地方',
  slot_filled: '这一格已经有字了',
  not_a_tray_item: '这个字不在字盘上',
  out_of_bounds: '这里没有空位',
};

export function IdiomDragGame() {
  const [state, setState] = useState<GameState>(INITIAL);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  // Bumped to make the loader run again — the retry button changes it, and
  // the effect below watches it.
  const [reloadToken, setReloadToken] = useState(0);

  // Load the idioms. The tier decides which levels the game draws from:
  // easy takes the common ones, medium takes the everyday ones and the
  // common ones, hard takes everything. `maxLevel` is what makes the hard
  // tier reach the literary rows — a `level=3` filter would leave the
  // twenty level-4 idioms unreachable.
  useEffect(() => {
    let cancelled = false;
    const maxLevel = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 4;
    setState((current) => ({ ...current, phase: 'loading', error: '' }));
    fetchIdioms(undefined, maxLevel)
      .then((result) => {
        if (cancelled) return;
        if (result.failed) {
          setState({
            ...INITIAL,
            phase: 'error',
            error: '成语数据暂时读不出来，请稍后再试。',
          });
          return;
        }
        if (result.idioms.length === 0) {
          setState({
            ...INITIAL,
            phase: 'error',
            error: '还没有成语数据，请先在后台导入。',
          });
          return;
        }
        setState({ ...READY, pool: result.idioms });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[idiom-game] the idioms could not be loaded', err);
        setState({
          ...INITIAL,
          phase: 'error',
          error: '成语数据暂时读不出来，请稍后再试。',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [difficulty, reloadToken]);

  /**
   * Start the next round.
   *
   * The seed advances on every round rather than being the clock's
   * millisecond: two rounds started inside the same millisecond would draw
   * the same idiom and the same blanked slots, and the player would see the
   * board repeat itself.
   */
  const nextRound = useCallback(() => {
    setState((current) => {
      const seed = (current.seed + 1) >>> 0;
      if (current.pool.length === 0) return { ...current, seed };
      const config = IDIOM_CONFIG[difficulty];
      const idiom = current.pool[seed % current.pool.length];
      const round = buildRound(idiom, config, seed, current.pool);
      return {
        ...current,
        phase: 'playing',
        round,
        selectedTrayId: null,
        message: '',
        seed,
      };
    });
  }, [difficulty]);

  /** Drop the selected tray tile into a slot. */
  const dropInto = useCallback(
    (slotIndex: number, trayItemId: string) => {
      setState((current) => {
        if (!current.round) return current;
        const result = dropCharacter(current.round, slotIndex, trayItemId);
        if (!result.ok) {
          playThud();
          return {
            ...current,
            selectedTrayId: null,
            message: REFUSAL_TEXT[result.reason] ?? '放不下',
          };
        }
        playChime();
        const next = result.state;
        if (isRoundWon(next)) {
          playFanfare();
          return {
            ...current,
            phase: 'won',
            round: next,
            selectedTrayId: null,
            message: '',
            solved: current.solved + 1,
          };
        }
        return {
          ...current,
          round: next,
          selectedTrayId: null,
          message: '',
        };
      });
    },
    [],
  );

  /** Pick a tray tile up, or put it down again. */
  const toggleTrayItem = useCallback((trayItemId: string) => {
    setState((current) => ({
      ...current,
      selectedTrayId: current.selectedTrayId === trayItemId ? null : trayItemId,
      message: '',
    }));
  }, []);

  /** Take a character back out of a slot. */
  const liftFromSlot = useCallback((slotIndex: number) => {
    setState((current) => {
      if (!current.round) return current;
      const next = liftCharacter(current.round, slotIndex);
      if (next === current.round) return current;
      // A lift is a correction, not a mistake, so it gets no error cue —
      // the tile simply reappears in the tray.
      return { ...current, round: next, message: '' };
    });
  }, []);

  const round = state.round;
  const remaining = round ? blanksRemaining(round) : 0;

  const startCard = useMemo(
    () => (
      <div className="rounded-lg border border-ink/20 bg-paper p-6">
        <h2 className="text-lg font-semibold">成语拖字</h2>
        <p className="mt-2 text-sm text-ink/70">
          把上面一排字拖进下面的空格里，拼出完整的成语。
        </p>
        <ul className="mt-3 space-y-1 text-sm text-ink/70">
          <li>● 上面字盘里的字是乱的，其中几个是干扰字。</li>
          <li>● 把正确的字拖到对应的空格；也可以先点字、再点空格。</li>
          <li>● 填错了可以点空格把字取回来。</li>
        </ul>
        <p className="mt-3 text-xs text-ink/50">
          简单 · 挖 1 个空；普通 · 挖 2 个空；困难 · 挖 3 个空。
        </p>
        <div className="mt-4">
          <DifficultyPicker value={difficulty} onChange={setDifficulty} />
        </div>
        <button
          type="button"
          className="mt-4 rounded border border-seal/40 bg-seal/10 px-4 py-2 text-sm hover:bg-seal/20"
          onClick={nextRound}
        >
          开始
        </button>
      </div>
    ),
    [difficulty, nextRound, state.pool],
  );

  if (state.phase === 'loading') {
    return (
      <div className="rounded-lg border border-ink/20 bg-paper p-6 text-sm text-ink/70">
        正在取成语……
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-ink/20 bg-paper p-6">
        <p className="text-sm text-ink/70">{state.error}</p>
        <button
          type="button"
          className="mt-4 rounded border border-seal/40 bg-seal/10 px-4 py-2 text-sm hover:bg-seal/20"
          onClick={() => setReloadToken((current) => current + 1)}
        >
          重试
        </button>
      </div>
    );
  }

  if (state.phase === 'ready' || !round) {
    return (
      <div className="space-y-4">
        {startCard}
      </div>
    );
  }

  const idiomChars = charactersOf(round.idiom);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink/20 bg-paper p-4">
        <div className="flex items-center justify-between text-sm text-ink/60">
          <span>还剩 {remaining} 个空</span>
          <span>已拼好 {state.solved} 个</span>
        </div>
      </div>

      {/* The tray. */}
      <div
        className="flex flex-wrap gap-2 rounded-lg border border-ink/20 bg-paper-deep p-4"
        data-testid="idiom-tray"
      >
        {round.tray.map((item) => (
          <button
            key={item.id}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', item.id);
              event.dataTransfer.effectAllowed = 'move';
              setState((current) => ({ ...current, selectedTrayId: item.id }));
            }}
            onClick={() => toggleTrayItem(item.id)}
            className={`flex h-14 w-14 cursor-grab flex-col items-center justify-center rounded border text-xl active:cursor-grabbing ${
              state.selectedTrayId === item.id
                ? 'border-seal bg-seal/20'
                : 'border-ink/20 bg-paper hover:bg-seal/10'
            }`}
            aria-pressed={state.selectedTrayId === item.id}
            aria-label={`字 ${item.char}${item.pinyin ? `，读作 ${item.pinyin}` : ''}`}
          >
            <span>{item.char}</span>
            {item.pinyin ? (
              <span className="text-[10px] leading-none text-ink/50">{item.pinyin}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* The answer area. */}
      <div
        className="flex flex-wrap items-end justify-center gap-3 rounded-lg border border-ink/20 bg-paper p-6"
        data-testid="idiom-board"
      >
        {round.slots.map((slot) => {
          const expected = idiomChars[slot.index];
          const isSelected = state.selectedTrayId !== null;
          return (
            <button
              key={slot.index}
              type="button"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const trayItemId = event.dataTransfer.getData('text/plain');
                if (trayItemId) dropInto(slot.index, trayItemId);
              }}
              onClick={() => {
                if (state.selectedTrayId) {
                  dropInto(slot.index, state.selectedTrayId);
                } else if (slot.char !== '' && slot.isBlank) {
                  liftFromSlot(slot.index);
                }
              }}
              className={`flex h-20 w-20 flex-col items-center justify-center rounded border-2 text-3xl ${
                slot.char === ''
                  ? 'border-dashed border-ink/30 bg-paper-deep text-ink/30'
                  : slot.isBlank
                    ? 'border-seal bg-seal/10'
                    : 'border-ink/20 bg-paper-deep'
              } ${isSelected && slot.char === '' ? 'ring-2 ring-seal/40' : ''}`}
              aria-label={
                slot.char === ''
                  ? `第 ${slot.index + 1} 个空，需要 ${expected}`
                  : `第 ${slot.index + 1} 个字 ${slot.char}${slot.pinyin ? `，读作 ${slot.pinyin}` : ''}`
              }
            >
              {slot.char === '' ? '？' : slot.char}
              {slot.pinyin ? (
                <span className="text-[11px] leading-none text-ink/50">{slot.pinyin}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {state.message ? (
        <p className="text-center text-sm text-seal" role="status">
          {state.message}
        </p>
      ) : null}

      {state.phase === 'won' ? (
        <div className="rounded-lg border border-seal/40 bg-seal/10 p-6 text-center">
          <p className="text-lg font-semibold">拼对了：{round.idiom.word}</p>
          <p className="mt-1 text-sm text-ink/70">{round.idiom.meaning}</p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              className="rounded border border-seal/40 bg-paper px-4 py-2 text-sm hover:bg-seal/10"
              onClick={nextRound}
            >
              再来一个
            </button>
            <button
              type="button"
              className="rounded border border-ink/20 bg-paper px-4 py-2 text-sm hover:bg-ink/5"
              onClick={() => setState({ ...READY, pool: state.pool })}
            >
              换难度
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
