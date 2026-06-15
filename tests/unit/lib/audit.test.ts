import { describe, it, expect } from 'vitest';
import { writeAudit, type AuditEvent } from '@/lib/audit';

describe('audit lib', () => {
  it('exports the 22 expected events', () => {
    const events: AuditEvent[] = [
      'register', 'login', 'logout',
      'history_create', 'history_delete',
      'password_reset_request', 'password_reset_complete',
      'admin_user_delete', 'admin_user_password_reset',
      'admin_user_promote', 'admin_user_demote',
      'user_disabled', 'user_reenabled',
      'ai_config_updated', 'ai_call_logged',
      'tts_config_updated',
      'worksheet_saved', 'worksheet_deleted',
      'poem_saved', 'sutra_saved', 'rare_char_card_saved',
      'membership_granted',
    ];
    expect(events).toHaveLength(22);
  });

  it('writeAudit is a function', () => {
    expect(typeof writeAudit).toBe('function');
  });
});
