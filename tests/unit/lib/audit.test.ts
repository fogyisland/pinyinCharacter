import { describe, expect, it } from 'vitest';
import {
  AUDIT_EVENTS,
  EVENT_LABEL,
  formatLogMessage,
} from '@/lib/audit-format';

/**
 * The audit event catalogue.
 *
 * `AuditEvent` is a union of every event the site can log, and it is spread
 * over four places in lib/audit-format.ts: the union itself, the AUDIT_EVENTS
 * tuple (the admin filter dropdown), the EVENT_LABEL record (the dropdown's
 * Chinese labels) and formatLogMessage (the sentence in the log row).
 *
 * The type checker ties the union to EVENT_LABEL (it is a Record over the
 * union) and to AUDIT_EVENTS (the tuple satisfies the union), but nothing
 * ties AUDIT_EVENTS to EVENT_LABEL. That is what the first test covers: the
 * tuple must list exactly the events that have a label, so an event can
 * never be added to one place and forgotten in another.
 */

describe('the audit event catalogue', () => {
  it('lists every labelled event in the tuple, and nothing twice', () => {
    expect([...AUDIT_EVENTS].sort()).toEqual(Object.keys(EVENT_LABEL).sort());
    expect(new Set(AUDIT_EVENTS).size).toBe(AUDIT_EVENTS.length);
  });

  it('labels the three MCP token events in Chinese', () => {
    expect(EVENT_LABEL.mcp_token_created).toBe('签发 MCP Token');
    expect(EVENT_LABEL.mcp_token_regenerated).toBe('重新生成 MCP Token');
    expect(EVENT_LABEL.mcp_token_revoked).toBe('吊销 MCP Token');
  });

  it('formats the MCP token log messages with the username', () => {
    expect(formatLogMessage('mcp_token_created', { username: 'xiaoming' })).toContain('xiaoming');
    expect(formatLogMessage('mcp_token_regenerated', { username: 'xiaoming' })).toContain(
      'xiaoming',
    );
    expect(formatLogMessage('mcp_token_revoked', { username: 'xiaoming' })).toContain('xiaoming');
  });
});
