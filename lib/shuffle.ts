/**
 * Fisher-Yates shuffle utilities. Shared between server (buildRound) and
 * client (ToneRadicalGame) so both use the SAME correct swap.
 *
 * Regression note (2026-07-03): both prior copies inlined had
 * `[a[i], a[j]] = [a[j]!, a[j]!]` — duplicating a[j] into a[i] without
 * preserving a[i]. This dropped/duplicated elements, which leaked into
 * `/api/game/round` `pinyinChoices` and triggered React duplicate-key
 * warnings in `<PinyinToken key={p}>`.
 *
 * Regression note (2026-10-25): the LCG advanced with
 * `(s * 1103515245 + 12345) & 0x7fffffff`. The product exceeds 2^53, so
 * float64 silently truncates the low bits, and the shuffle index was taken
 * from those low bits — which have period 2. Measured over 8952 char x kind
 * combinations, the correct option landed in slot 3 for 99.9% of them, so
 * every seeded round had a fixed answer position. `Math.imul` keeps the LCG
 * exact in 32 bits and the index now comes from the high bits.
 */

export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = (s >>> 16) % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
