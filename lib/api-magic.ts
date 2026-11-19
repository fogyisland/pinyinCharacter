/**
 * lib/api-magic.ts — asking the server for the relation table.
 *
 * The table is several megabytes, so it is not bundled into the client.
 * The client asks for it once, when the game starts, and the server
 * reads it from the build product.
 *
 * The table's TYPE comes from the server module, but only the type is
 * imported here — the value never reaches the client bundle.
 */
import type { MagicTable } from './magic-char-data';

/**
 * Fetches the one-stroke relation table from the server.
 *
 * A failure throws with a message that says what went wrong: an HTTP
 * error means the server could not read the table, and a malformed body
 * means the answer did not hold one.
 */
export async function fetchMagicTable(): Promise<MagicTable> {
  const res = await fetch('/api/game/magic');
  if (!res.ok) {
    throw new Error(`the relation table could not be loaded: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    ok: boolean;
    data?: { table?: MagicTable };
  };
  if (!body.ok || !body.data?.table) {
    throw new Error('the relation table response was malformed');
  }
  return body.data.table;
}
