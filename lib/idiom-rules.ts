/**
 * The rules of the idiom drag game.
 *
 * The game shows an idiom with some of its characters blanked out, and a
 * tray of candidate characters above it. The player drags the right
 * character into each blank.
 *
 * This module holds every rule, and nothing else — no React, no DOM, no
 * fetch, no timers, no storage. That keeps the rules testable on their own
 * and keeps the component a thin shell over them.
 *
 * The shape of a round:
 *
 *  - the idiom has four slots;
 *  - some slots are filled and some are blank;
 *  - the tray holds the missing characters plus distractors;
 *  - dragging a character into a slot either takes it (the slot now holds
 *    that character) or is refused, with a reason the player can read.
 *
 * A round is won when every slot holds the character the idiom has there.
 */
import { makeRng } from './catch-char-rules';

/** One idiom as the game uses it. */
export interface GameIdiom {
  /** The four characters, e.g. "一帆风顺". */
  word: string;
  /** Space-separated tone-marked readings, one per character. */
  pinyin: string;
  /** A Chinese explanation of the meaning. */
  meaning: string;
  /** Difficulty, 1 (easiest) to 4 (literary). */
  level: number;
  /** The theme the idiom belongs to. */
  category: string;
}

/** One slot of the answer area. */
export interface IdiomSlot {
  /** Which position of the idiom this slot is, 0-3. */
  index: number;
  /** The character the idiom has here, or '' when the slot is blank. */
  char: string;
  /** The reading of that character, or '' when the slot is blank. */
  pinyin: string;
  /** Whether the slot started blank. Only a slot that started blank can be emptied. */
  isBlank: boolean;
}

/** One character in the tray. */
export interface TrayItem {
  /** A unique key for this tray entry, so two identical characters are two entries. */
  id: string;
  /** The character itself. */
  char: string;
  /** The reading of the character. */
  pinyin: string;
}

/** The state of one round. */
export interface IdiomRound {
  /** The idiom being solved. */
  idiom: GameIdiom;
  /** The four slots, in order. */
  slots: readonly IdiomSlot[];
  /** The tray of candidate characters. */
  tray: readonly TrayItem[];
  /** How many characters the player has placed. */
  placed: number;
}

/** How the game is set up. */
export interface IdiomConfig {
  /** How many of the four slots start blank. */
  blanks: number;
  /** How many distractors the tray holds besides the missing characters. */
  distractors: number;
}

/** The configuration for each difficulty. */
export const IDIOM_CONFIG: Readonly<Record<'easy' | 'medium' | 'hard', IdiomConfig>> = {
  easy: { blanks: 1, distractors: 2 },
  medium: { blanks: 2, distractors: 3 },
  hard: { blanks: 3, distractors: 4 },
};

/** Why a drag was refused. */
export type DropRejectReason =
  | 'wrong_character'
  | 'slot_filled'
  | 'not_a_tray_item'
  | 'out_of_bounds';

/** What happened when a character was dropped. */
export type DropResult =
  | { readonly ok: true; readonly state: IdiomRound }
  | { readonly ok: false; readonly reason: DropRejectReason };

/** The readings of an idiom, one per character. */
export function readingsOf(idiom: GameIdiom): string[] {
  return idiom.pinyin.split(/\s+/).filter(Boolean);
}

/**
 * The characters of the idiom, one per position.
 *
 * `[...idiom.word]` rather than `idiom.word.split('')`, because the spread
 * counts code points: a surrogate pair would be two halves in `split` and
 * one character in the spread, and the slots would not line up with the
 * readings.
 */
export function charactersOf(idiom: GameIdiom): string[] {
  return [...idiom.word];
}

/**
 * Pick the slots that start blank.
 *
 * The blank positions are drawn at random so the same idiom does not always
 * hide the same character, but the FIRST slot is never blanked when there is
 * more than one blank: the player needs an anchor they can read to work out
 * the rest, and a fully-blank idiom gives nothing to reason from.
 *
 * With a single blank, that blank may be the first slot — a one-character
 * hole is still a solvable question, and forcing it elsewhere would make
 * the same idiom always look the same.
 */
export function chooseBlankSlots(
  idiom: GameIdiom,
  blanks: number,
  rng: () => number,
): number[] {
  const total = charactersOf(idiom).length;
  const count = Math.max(0, Math.min(blanks, total));
  if (count === 0) return [];

  // With more than one blank, the first slot stays filled as the anchor.
  const candidates =
    count > 1 ? Array.from({ length: total }, (_, index) => index).slice(1) : Array.from({ length: total }, (_, index) => index);
  const chosen: number[] = [];
  for (let i = 0; i < count; i++) {
    const pick = Math.floor(rng() * candidates.length);
    chosen.push(candidates[pick]);
    candidates.splice(pick, 1);
  }
  return chosen.sort((a, b) => a - b);
}

/**
 * Build a round from an idiom.
 *
 * The tray holds the characters of the blanked slots plus the distractors.
 * The distractors are other characters from the same pool — never the same
 * character as a missing one, or the tray would hold two identical tiles and
 * the player could not tell them apart.
 */
export function buildRound(
  idiom: GameIdiom,
  config: IdiomConfig,
  seed: number,
  pool: readonly GameIdiom[],
): IdiomRound {
  const rng = makeRng(seed);
  const chars = charactersOf(idiom);
  const readings = readingsOf(idiom);
  const blankSlots = chooseBlankSlots(idiom, config.blanks, rng);
  const blankSet = new Set(blankSlots);

  const slots: IdiomSlot[] = chars.map((char, index) => ({
    index,
    char: blankSet.has(index) ? '' : char,
    pinyin: blankSet.has(index) ? '' : (readings[index] ?? ''),
    isBlank: blankSet.has(index),
  }));

  // The reading of every character that may show up in the tray. The
  // idiom's own characters come first, so a missing character keeps the
  // reading the dictionary page shows for it.
  const readingOf = new Map<string, string>();
  chars.forEach((char, index) => {
    if (readings[index]) readingOf.set(char, readings[index]);
  });
  for (const source of pool) {
    const sourceChars = charactersOf(source);
    const sourceReadings = readingsOf(source);
    sourceChars.forEach((char, index) => {
      if (!readingOf.has(char) && sourceReadings[index]) {
        readingOf.set(char, sourceReadings[index]);
      }
    });
  }

  // The distractors come from the other idioms, so they are real characters
  // of real words rather than arbitrary glyphs.
  const distractors: string[] = [];
  const used = new Set(chars);
  let guard = 0;
  while (distractors.length < config.distractors && guard < 500) {
    guard++;
    const source = pool[Math.floor(rng() * pool.length)];
    if (!source) break;
    const sourceChars = charactersOf(source);
    const candidate = sourceChars[Math.floor(rng() * sourceChars.length)];
    if (!candidate || used.has(candidate)) continue;
    used.add(candidate);
    distractors.push(candidate);
  }

  const missing = blankSlots.map((index) => chars[index]);
  const trayChars = [...missing, ...distractors];
  // Shuffle so the missing characters are not always at the front.
  for (let i = trayChars.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [trayChars[i], trayChars[j]] = [trayChars[j], trayChars[i]];
  }

  const tray: TrayItem[] = trayChars.map((char, index) => ({
    id: `${index}:${char}`,
    char,
    pinyin: readingOf.get(char) ?? '',
  }));

  return {
    idiom,
    slots,
    tray,
    placed: 0,
  };
}

/**
 * Drop a tray character into a slot.
 *
 * The drop is refused when the slot is out of bounds, when it already holds
 * a character, when the tray item does not exist, or when the character is
 * not the one the idiom has in that slot.
 *
 * The wrong-character case is the interesting one: the tray holds
 * distractors, and dropping one into a slot must not fill it. A slot only
 * ever accepts its own character, so a player cannot stumble into a wrong
 * answer that then has to be undone.
 */
export function dropCharacter(
  state: IdiomRound,
  slotIndex: number,
  trayItemId: string,
): DropResult {
  const slot = state.slots[slotIndex];
  if (!slot) return { ok: false, reason: 'out_of_bounds' };
  if (slot.char !== '') return { ok: false, reason: 'slot_filled' };

  const item = state.tray.find((entry) => entry.id === trayItemId);
  if (!item) return { ok: false, reason: 'not_a_tray_item' };

  const expected = charactersOf(state.idiom)[slotIndex];
  if (item.char !== expected) return { ok: false, reason: 'wrong_character' };

  const slots = state.slots.map((entry) =>
    entry.index === slotIndex
      ? { ...entry, char: item.char, pinyin: item.pinyin || entry.pinyin }
      : entry,
  );
  const tray = state.tray.filter((entry) => entry.id !== trayItemId);

  return {
    ok: true,
    state: {
      ...state,
      slots,
      tray,
      placed: state.placed + 1,
    },
  };
}

/**
 * Take a character back out of a slot.
 *
 * The player can undo a drop: the character returns to the tray. Only a
 * slot that STARTED blank can be emptied — the ones the game filled in are
 * part of the question, and emptying them would let the player solve it
 * without reading anything.
 */
export function liftCharacter(state: IdiomRound, slotIndex: number): IdiomRound {
  const slot = state.slots[slotIndex];
  if (!slot || slot.char === '') return state;
  if (!slot.isBlank) return state;

  const tray = [
    ...state.tray,
    {
      id: `lifted:${slotIndex}:${slot.char}:${state.tray.length}`,
      char: slot.char,
      pinyin: slot.pinyin,
    },
  ];
  const slots = state.slots.map((entry) =>
    entry.index === slotIndex ? { ...entry, char: '', pinyin: '' } : entry,
  );
  return {
    ...state,
    slots,
    tray,
    placed: Math.max(0, state.placed - 1),
  };
}

/** Whether every slot holds the character the idiom has there. */
export function isRoundWon(state: IdiomRound): boolean {
  const chars = charactersOf(state.idiom);
  return state.slots.every((slot, index) => slot.char === chars[index]);
}

/** How many slots are still blank. */
export function blanksRemaining(state: IdiomRound): number {
  return state.slots.filter((slot) => slot.char === '').length;
}

/**
 * Whether the player can still make progress.
 *
 * A round is stuck when a blank slot's character is no longer in the tray.
 * That cannot happen through the normal flow — a drop puts a character in a
 * slot and removes it from the tray, and lifting puts it back — so this
 * guards against a state the game built wrongly, and the component shows a
 * hint when it fires.
 */
export function isRoundStuck(state: IdiomRound): boolean {
  const chars = charactersOf(state.idiom);
  return state.slots.some(
    (slot, index) =>
      slot.char === '' &&
      !state.tray.some((item) => item.char === chars[index]),
  );
}
