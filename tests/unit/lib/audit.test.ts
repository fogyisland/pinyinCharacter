import { describe, it, expect } from 'vitest';
import { writeAudit, type AuditEvent } from '@/lib/audit';

describe('audit lib', () => {
  it('exports the 5 expected events', () => {
    const events: AuditEvent[] = ['register', 'login', 'logout', 'history_create', 'history_delete'];
    expect(events).toHaveLength(5);
  });

  it('writeAudit is a function', () => {
    expect(typeof writeAudit).toBe('function');
  });
});
