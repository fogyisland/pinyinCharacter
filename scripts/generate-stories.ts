/**
 * One-shot script: read all rare_chars with empty meaning, batch-call an LLM
 * to generate meaning + story, write back.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/generate-stories.ts --provider openai --model gpt-4o-mini
 *
 * Re-runnable: skips rows that already have a non-empty meaning.
 */
import { getPool, closePool } from '../lib/db';
import { batchGenerateStories } from '../lib/ai-rare-chars';

function parseArgs(): { provider: string; model: string } {
  const args = process.argv.slice(2);
  let provider = '';
  let model = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') provider = args[++i] ?? '';
    else if (args[i] === '--model') model = args[++i] ?? '';
  }
  if (!provider || !model) {
    console.error('Usage: --provider <name> --model <id>');
    process.exit(1);
  }
  return { provider, model };
}

async function main() {
  const { provider, model } = parseArgs();
  const pool = getPool();

  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, pinyin FROM rare_chars WHERE meaning = '' ORDER BY \`char\` ASC`
  );
  console.log(`[generate-stories] ${rows.length} chars need stories`);

  const inputs = rows.map((r) => ({ char: r.char as string, pinyin: r.pinyin as string }));

  const updated = await batchGenerateStories(inputs, {
    provider,
    model,
    onError: (err, batch) => {
      console.error(`[generate-stories] batch failed (${batch.length} chars):`, err);
    },
  });
  console.log(`[generate-stories] updated ${updated} rows`);

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
