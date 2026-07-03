import type { GameRound } from './game-round-types';
import type { CharSource } from './difficulty';

export type { GameRound, RoundChar } from './game-round-types';

export async function fetchGameRound(
  count = 4,
  seed?: number,
  source: CharSource = 'chars-all',
): Promise<GameRound> {
  const params = new URLSearchParams();
  params.set('count', String(count));
  if (seed !== undefined) params.set('seed', String(seed));
  params.set('source', source);
  const res = await fetch(`/api/game/round?${params.toString()}`);
  const json = (await res.json()) as { ok: boolean; data: GameRound; error?: { code: string } };
  if (!json.ok) throw new Error(`fetchGameRound failed: ${json.error?.code ?? 'unknown'}`);
  return json.data;
}
