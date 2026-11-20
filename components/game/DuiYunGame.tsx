'use client';

/**
 * 对韵消消 — the couplet matching game.
 *
 * A couplet is shown with some of its characters blanked out, and a tray of
 * candidate characters sits above it. The player drags the right character
 * into each blank. The two lines answer each other in 平仄 — at every
 * position one side is a ping tone and the other is a ze tone — and the
 * board marks each character with its 平 or 仄 so the player can see why a
 * character belongs where it does.
 *
 * The RULES live in `lib/duiyun-rules.ts` — which slots start blank, what
 * the tray holds, which drops are refused and how the round is won. This
 * file is the rendering: the tray, the board, the drag handlers and the
 * round lifecycle.
 *
 * The drag is implemented with the HTML drag-and-drop API rather than with
 * pointer events. That is a deliberate choice: the HTML API gives the
 * browser's own drag image, every tile is also a button that can be
 * clicked into the selected blank, and there is no rAF loop to keep alive.
 * The click-to-select path is the one a keyboard user and a touch-screen
 * user both need, and it is the same code path — a click sets the selected
 * tile, a second click on a slot drops it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDuiyunPairs } from '@/lib/api-duiyun';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { playChime, playFanfare, playThud } from '@/lib/game-sound';
import {
  DUIYUN_CONFIG,
  blanksRemaining,
  buildRound,
  dropCharacter,
  isRoundWon,
  liftCharacter,
  type DuiyunPair,
  type DuiyunRound,
} from '@/lib/duiyun-rules';
import type { Difficulty } from '@/lib/difficulty';

type Phase = 'loading' | 'ready' | 'playing' | 'won' | 'error';

/** What the component remembers between rounds. */
interface GameState {
  phase: Phase;
  /** The couplets the game draws from. */
  pool: DuiyunPair[];
  /** The round being played. */
  round: DuiyunRound | null;
  /** The tray tile the player picked up, if any. */
  selectedTileId: string | null;
  /** The message shown under the board. */
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
  selectedTileId: null,
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
  selectedTileId: null,
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
};

/** 平 or 仄, for a tone. */
function toneMark(tone: number): string {
  return tone === 1 || tone === 2 ? '平' : '仄';
}

export function DuiYunGame() {
  const [state, setState] = useState<GameState>(INITIAL);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  /**
   * The selected tile, mirrored in a ref.
   *
   * The state is what the screen draws, but a click handler cannot read it
   * reliably: React batches the update, so a player who clicks a tile and
   * then the slot - two clicks in one breath - hands the slot's handler a
   * closure from *before* the tile was picked. The handler would see no
   * selection and do nothing, and the game would look broken.
   *
   * The ref is written the moment the tile is picked, so the very next
   * click reads the truth.
   */
  const selectedTileRef = useRef<string | null>(null);
  // Bumped to make the loader run again — the retry button changes it, and
  // the effect below watches it.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, phase: 'loading', error: '' }));
    fetchDuiyunPairs()
      .then((result) => {
        if (cancelled) return;
        if (result.failed) {
          setState({
            ...INITIAL,
            phase: 'error',
            error: '对韵数据暂时读不出来，请稍后再试。',
          });
          return;
        }
        if (result.pairs.length === 0) {
          setState({
            ...INITIAL,
            phase: 'error',
            error: '还没有对韵数据，请先运行数据抽取脚本。',
          });
          return;
        }
        setState({ ...READY, pool: result.pairs });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[duiyun-game] the couplets could not be loaded', err);
        setState({
          ...INITIAL,
          phase: 'error',
          error: '对韵数据暂时读不出来，请稍后再试。',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  /**
   * Start the next round.
   *
   * The seed advances on every round rather than being the clock's
   * millisecond: two rounds started inside the same millisecond would draw
   * the same couplet and the same blanked slots, and the player would see
   * the board repeat itself.
   */
  const nextRound = useCallback(() => {
    setState((current) => {
      const seed = (current.seed + 1) >>> 0;
      selectedTileRef.current = null;
      if (current.pool.length === 0) return { ...current, seed };
      const config = DUIYUN_CONFIG[difficulty];
      const pair = current.pool[seed % current.pool.length];
      const round = buildRound(pair, config, seed, current.pool);
      return {
        ...current,
        phase: 'playing',
        round,
        selectedTileId: null,
        message: '',
        seed,
      };
    });
  }, [difficulty]);

  /** Drop the selected tray tile into a slot. */
  const dropInto = useCallback(
    (slotIndex: number, tileId: string) => {
      setState((current) => {
        if (!current.round) return current;
        const result = dropCharacter(current.round, slotIndex, tileId);
        // The tile is spent either way - a refused drop takes the selection
        // back too, so the player is not left holding a tile that is gone.
        selectedTileRef.current = null;
        if (!result.ok) {
          playThud();
          return {
            ...current,
            selectedTileId: null,
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
            selectedTileId: null,
            message: '',
            solved: current.solved + 1,
          };
        }
        return {
          ...current,
          round: next,
          selectedTileId: null,
          message: '',
        };
      });
    },
    [],
  );

  /** Pick a tray tile up, or put it down again. */
  const toggleTile = useCallback((tileId: string) => {
    const next = selectedTileRef.current === tileId ? null : tileId;
    // The ref first: the next click has to see this, batched or not.
    selectedTileRef.current = next;
    setState((current) => ({
      ...current,
      selectedTileId: next,
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
        <h2 className="text-lg font-semibold">对韵消消</h2>
        <p className="mt-2 text-sm text-ink/70">
          上下句各挖掉几个字，把字盘里的字放回正确的位置。
        </p>
        <ul className="mt-3 space-y-1 text-sm text-ink/70">
          <li>● 上下句的字一一相对，平声对仄声、仄声对平声。</li>
          <li>● 把正确的字拖到空格；也可以先点字、再点空格。</li>
          <li>● 填错了可以点空格把字取回来。</li>
        </ul>
        <p className="mt-3 text-xs text-ink/50">
          简单 · 挖 1 个空；复杂 · 挖 2 个空；超难 · 挖 3 个空。
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
        正在取对韵……
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

  const upperSlots = round.slots.filter((slot) => slot.side === 0);
  const lowerSlots = round.slots.filter((slot) => slot.side === 1);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink/20 bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink/60">
          <span>还剩 {remaining} 个空</span>
          <span>已拼好 {state.solved} 副</span>
          <span>韵部 · {round.pair.rhyme}</span>
        </div>
      </div>

      {/* The tray. */}
      <div
        className="flex flex-wrap gap-2 rounded-lg border border-ink/20 bg-paper-deep p-4"
        data-testid="duiyun-tray"
      >
        {round.tray.map((tile) => (
          <button
            key={tile.id}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', tile.id);
              event.dataTransfer.effectAllowed = 'move';
              selectedTileRef.current = tile.id;
              setState((current) => ({ ...current, selectedTileId: tile.id }));
            }}
            onClick={() => toggleTile(tile.id)}
            className={`flex h-14 w-14 cursor-grab flex-col items-center justify-center rounded border text-xl active:cursor-grabbing ${
              state.selectedTileId === tile.id
                ? 'border-seal bg-seal/20'
                : 'border-ink/20 bg-paper hover:bg-seal/10'
            }`}
            aria-pressed={state.selectedTileId === tile.id}
            aria-label={`字 ${tile.char}，读作 ${tile.pinyin}`}
          >
            <span>{tile.char}</span>
            <span className="text-[10px] leading-none text-ink/50">{tile.pinyin}</span>
          </button>
        ))}
      </div>

      {/* The two lines. */}
      <div
        className="space-y-3 rounded-lg border border-ink/20 bg-paper p-6"
        data-testid="duiyun-board"
      >
        {[upperSlots, lowerSlots].map((side, sideIndex) => (
          <div key={sideIndex} className="flex flex-wrap items-end justify-center gap-3">
            {side.map((slot) => {
              const globalIndex = round.slots.indexOf(slot);
              const isOpen = slot.isBlank && !slot.filled;
              return (
                <button
                  key={`${slot.side}-${slot.index}`}
                  type="button"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const tileId = event.dataTransfer.getData('text/plain');
                    if (tileId) dropInto(globalIndex, tileId);
                  }}
                  onClick={() => {
                    // The ref, not the state: the selection may have been
                    // made a moment ago and React has not re-rendered yet.
                    const selected = selectedTileRef.current;
                    if (selected) {
                      dropInto(globalIndex, selected);
                    } else if (slot.filled) {
                      liftFromSlot(globalIndex);
                    }
                  }}
                  className={`flex h-20 w-20 flex-col items-center justify-center rounded border-2 text-3xl ${
                    isOpen
                      ? 'border-dashed border-ink/30 bg-paper-deep text-ink/30'
                      : slot.filled
                        ? 'border-seal bg-seal/10'
                        : 'border-ink/20 bg-paper-deep'
                  } ${state.selectedTileId && isOpen ? 'ring-2 ring-seal/40' : ''}`}
                  aria-label={
                    isOpen
                      ? `第 ${slot.index + 1} 个空，需要 ${slot.char}`
                      : `第 ${slot.index + 1} 个字 ${slot.char}，读作 ${slot.pinyin}`
                  }
                >
                  {isOpen ? '？' : slot.char}
                  <span className="text-[11px] leading-none text-ink/50">
                    {slot.pinyin} · {toneMark(slot.tone)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {state.message ? (
        <p className="text-center text-sm text-seal" role="status">
          {state.message}
        </p>
      ) : null}

      {state.phase === 'won' ? (
        <div className="rounded-lg border border-seal/40 bg-seal/10 p-6 text-center">
          <p className="text-lg font-semibold">拼对了：{round.pair.upper}</p>
          <p className="mt-1 text-sm text-ink/70">
            {round.pair.lower}　·　韵部 {round.pair.rhyme}　·　{round.pair.book}
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              className="rounded border border-seal/40 bg-paper px-4 py-2 text-sm hover:bg-seal/10"
              onClick={nextRound}
            >
              再来一副
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
