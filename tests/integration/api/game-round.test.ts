// @vitest-environment node
import { describe, it, expect } from 'vitest';

// 2026-07-04: Task 5 integration tests for /api/game/round?hskLevel=N.
// These tests hit the live dev server on port 4444 (per project memory
// dev-port.md). The server is NOT started by this file — these tests
// are skipped by default and must be run manually after `npx next dev -p 4444`
// to avoid CI flakiness. Mark a follow-up integration test once dev
// environment is provisioned (per task-5-brief.md Step 5.5).
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:4444';

describe('GET /api/game/round', () => {
  it.skip('accepts ?hskLevel=1 and embeds revealConfig', async () => {
    const res = await fetch(`${BASE}/api/game/round?count=3&mode=tone&hskLevel=1&source=chars-level-1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const data = await res.json();
    expect(data.revealConfig).toBeDefined();
    expect(data.revealConfig.cellHints).toContain('pinyin');
  });

  it.skip('rejects ?hskLevel=99 via zod', async () => {
    const res = await fetch(`${BASE}/api/game/round?hskLevel=99`);
    expect(res.status).toBe(400);
  });
});