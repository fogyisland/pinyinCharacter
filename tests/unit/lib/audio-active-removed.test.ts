/**
 * The public audio route is gone.
 *
 * `/api/audio/active` answered, without authentication, "what is the
 * default playlist" — a public information surface nobody called. It was
 * removed because the sutra player uses `/api/tts`, not this route.
 *
 * The route must STAY removed. If somebody wires a client back to it,
 * they get an unauthenticated endpoint again — so the reference is
 * pinned here rather than left to a grep someone remembers to run.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Every source file of the app, as absolute paths. */
function sourceFiles(): string[] {
  const found: string[] = [];
  // ⚠️ Every directory that holds TypeScript the app ships. A scan that
  // misses one is a scan with a hole in it: a client re-wired into
  // `server/` or `mcp/` would not be caught, and the endpoint would be
  // back without its authentication.
  for (const dir of ['app', 'lib', 'components', 'scripts', 'server', 'mcp']) {
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(path);
      }
    };
    const absolute = join(ROOT, dir);
    if (existsSync(absolute)) walk(absolute);
  }
  return found;
}

describe('the public audio route stays removed', () => {
  it('has no route file', () => {
    expect(existsSync(join(ROOT, 'app', 'api', 'audio'))).toBe(false);
  });

  it('is not referenced by any source file', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles()) {
      const text = readFileSync(path, 'utf8');
      if (text.includes('api/audio/active') || text.includes('getActiveTrack')) {
        offenders.push(path.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is not referenced by any source file — the playlist half too', () => {
    // `getActivePlaylist` was the route's only caller. Removing the route
    // without removing the function would just move the dead code — and
    // the function is a public export of `lib/playlists.ts`, so it can
    // be re-wired by accident.
    const offenders: string[] = [];
    for (const path of sourceFiles()) {
      const text = readFileSync(path, 'utf8');
      if (text.includes('getActivePlaylist')) {
        offenders.push(path.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
