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

  it('never renders an empty name for the MCP token events', () => {
    expect(formatLogMessage('mcp_token_created', {})).toContain('「?」');
    expect(formatLogMessage('mcp_token_regenerated', {})).toContain('「?」');
    expect(formatLogMessage('mcp_token_revoked', {})).toContain('「?」');
  });

  it('labels the five WeChat events in Chinese', () => {
    expect(EVENT_LABEL.wechat_config_updated).toBe('微信配置已更新');
    expect(EVENT_LABEL.wechat_broadcast_created).toBe('已创建微信公告');
    expect(EVENT_LABEL.wechat_broadcast_sent).toBe('已发送微信公告');
    expect(EVENT_LABEL.wechat_broadcast_cancelled).toBe('已取消微信公告');
    expect(EVENT_LABEL.wechat_test_sent).toBe('已发送微信测试消息');
  });

  it('never renders an empty title for the WeChat announcement events', () => {
    expect(formatLogMessage('wechat_broadcast_created', {})).toContain('「?」');
    expect(formatLogMessage('wechat_broadcast_sent', {})).toContain('「?」');
    expect(formatLogMessage('wechat_broadcast_cancelled', {})).toContain('「?」');
    expect(formatLogMessage('wechat_test_sent', {})).toContain('「?」');
  });

  it('renders the announcement title when there is one', () => {
    expect(formatLogMessage('wechat_broadcast_created', { title: 'v1.2 已上线' })).toContain(
      'v1.2 已上线',
    );
    expect(formatLogMessage('wechat_broadcast_sent', { title: 'v1.2 已上线' })).toContain(
      'v1.2 已上线',
    );
  });
});
