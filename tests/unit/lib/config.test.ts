// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { getConfig, setConfig, getAllConfig, setConfigBatch } from '../../../lib/config';

describe('config', () => {
  afterAll(async () => {
    await getPool().query(`DELETE FROM app_config WHERE \`key\` LIKE 'test.%'`);
    await closePool();
  });

  it('getConfig returns null for missing key', async () => {
    const v = await getConfig('test.does_not_exist');
    expect(v).toBeNull();
  });

  it('setConfig inserts/updates a value', async () => {
    await setConfig('test.foo', 'bar', null);
    expect(await getConfig('test.foo')).toBe('bar');
    await setConfig('test.foo', 'baz', null);
    expect(await getConfig('test.foo')).toBe('baz');
  });

  it('getAllConfig returns the seeded AI keys', async () => {
    const all = await getAllConfig();
    expect(all['ai.model']).toBe('gpt-4o-mini');
  });

  it('setConfigBatch validates values', async () => {
    await expect(
      setConfigBatch({ 'test.timeout': '30000' }, 0),
    ).resolves.toBeUndefined();
    // a key that doesn't match a known shape should still store
    expect(await getConfig('test.timeout')).toBe('30000');
  });
});
