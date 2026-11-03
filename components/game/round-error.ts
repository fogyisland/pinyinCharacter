/**
 * The error text of a failed round load.
 *
 * The API answers with a machine-readable code; the learner reads a sentence.
 * The mapping lives here so the wording is stated once and the component
 * keeps its line budget.
 *
 * 2026-11-03: the codes used to be shown to the learner verbatim
 * ("fetchGameRound failed: no_chars"), which reads as a bug report rather
 * than as a situation. They now say what happened and, where one exists,
 * what fixes it.
 */

import { HSK_LEVELS_NOT_IMPORTED } from '@/lib/game-quest-types';

/** The error codes the round API answers with. */
export type RoundErrorCode =
  | 'hsk_level_not_imported'
  | 'no_chars'
  | 'bad_input'
  | 'server';

/**
 * The Chinese text for a round failure.
 *
 * `unknown` is the fallback for a code this component does not know — the
 * learner still gets a sentence, and the raw code goes to the console for
 * the log.
 */
export function roundErrorText(code: string | undefined): string {
  switch (code) {
    case HSK_LEVELS_NOT_IMPORTED:
      return '这一层的汉字还没有导入 —— 需要管理员先导入 HSK 分级数据，请稍后再试';
    case 'no_chars':
      return '这一层的可用汉字不够凑一局 —— 换个难度或层级再试试';
    case 'bad_input':
      return '这一局的参数不对 —— 请刷新页面后重试';
    default:
      return '这一局暂时开不了 —— 请稍后再试';
  }
}

/**
 * The remedy shown under the error text.
 *
 * It is `null` when there is nothing the reader can do — the codes that carry
 * a remedy name the command, and a hint that points at the wrong command
 * sends the operator to fix something that is not broken.
 */
export function roundErrorRemedy(code: string | undefined): string | null {
  if (code === HSK_LEVELS_NOT_IMPORTED) {
    return 'npx tsx scripts/import-hsk.ts';
  }
  return null;
}
