import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCharTools } from './chars';
import { registerClassicTools } from './classics';
import { registerPoemTools } from './poems';
import { registerPinyinTools } from './pinyin';
import { registerQuestTools } from './quest';
import { registerSpeechTools } from './speech';
import { registerSutraTools } from './sutras';
import { registerWorksheetTools } from './worksheet';

/**
 * The tool registry.
 *
 * Every tool reads files — the character library, the poems, the scriptures,
 * the classical books, the stroke data — and computes from them. None of
 * them touches the database, which is what lets the MCP server run on a
 * machine that has no MySQL.
 */

/** Register every tool on the server. */
export function registerAllTools(server: McpServer): void {
  registerCharTools(server);
  registerPinyinTools(server);
  registerQuestTools(server);
  registerWorksheetTools(server);
  registerPoemTools(server);
  registerSutraTools(server);
  registerClassicTools(server);
  registerSpeechTools(server);
}
