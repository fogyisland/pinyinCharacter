export type RevealElement = 'pinyin' | 'radical' | 'meaning';
export type HskLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type GameMode = 'tone-radical' | 'drag-match' | 'chain';

export type RevealConfig = {
  cellHints: ReadonlyArray<RevealElement>;
  allowOnDemandHints: boolean;
  onDemandPenalty: number;
};

export const REVEAL_BY_LEVEL: Record<
  HskLevel,
  Pick<RevealConfig, 'cellHints' | 'allowOnDemandHints'>
> = {
  1: { cellHints: ['pinyin', 'meaning', 'radical'], allowOnDemandHints: false },
  2: { cellHints: ['pinyin', 'meaning'],            allowOnDemandHints: false },
  3: { cellHints: ['pinyin'],                       allowOnDemandHints: false },
  4: { cellHints: ['pinyin'],                       allowOnDemandHints: true  },
  5: { cellHints: [],                               allowOnDemandHints: true  },
  6: { cellHints: [],                               allowOnDemandHints: true  },
};

const NO_RADICAL_GAMES: ReadonlySet<GameMode> = new Set(['drag-match', 'chain']);
const PENALTY_BY_GAME: Record<GameMode, number> = {
  'tone-radical': 1,
  'drag-match': 1,
  'chain': 0,
};

export function getRevealConfig(game: GameMode, level: HskLevel): RevealConfig {
  const base = REVEAL_BY_LEVEL[level];
  const filtered: RevealElement[] = NO_RADICAL_GAMES.has(game)
    ? base.cellHints.filter((el) => el !== 'radical')
    : [...base.cellHints];
  return {
    cellHints: filtered,
    allowOnDemandHints: base.allowOnDemandHints,
    onDemandPenalty: PENALTY_BY_GAME[game],
  };
}
