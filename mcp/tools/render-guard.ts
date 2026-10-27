/**
 * The concurrency guard of the PNG renderer.
 *
 * A rendered page is a device-pixel canvas in memory: an A3 sheet at scale 2
 * is 27 MiB of RGBA, and the encoder copies it once more. The MCP endpoint is
 * public — any registered user can get a token — so the number of renders
 * that may run at the same time is capped here, in the process where the
 * memory is actually spent.
 *
 * The cap rejects the excess instead of queueing it: a queue only moves the
 * memory problem, and a caller that waits a long time for its answer is worse
 * off than one that is told to come back in a moment.
 */

/** How many renders may run at the same time. */
export const MAX_CONCURRENT_RENDERS = 2;

/** The renders that are running right now. */
let inFlight = 0;

/** How many renders are running right now. */
export function rendersInFlight(): number {
  return inFlight;
}

/**
 * Take a permit, or report that the renderer is full.
 *
 * The caller has to give the permit back with `releaseRenderPermit()` — from
 * a `finally`, so an exception cannot leak it.
 */
export function acquireRenderPermit(): boolean {
  if (inFlight >= MAX_CONCURRENT_RENDERS) return false;
  inFlight += 1;
  return true;
}

/** Give a permit back. */
export function releaseRenderPermit(): void {
  if (inFlight <= 0) {
    // A permit that is given back without having been taken is a bug in the
    // caller. It is logged rather than swallowed.
    console.error('[mcp] a render permit was released that was never taken');
    return;
  }
  inFlight -= 1;
}
