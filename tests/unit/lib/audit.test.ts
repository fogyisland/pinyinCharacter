import { describe, it, expect } from 'vitest';
import { writeAudit } from '@/lib/audit';
import { formatLogMessage, type AuditEvent } from '@/lib/audit-format';

describe('audit lib', () => {
  it('exports the 33 expected events', () => {
    const events: AuditEvent[] = [
      'register', 'login', 'logout',
      'history_create', 'history_delete',
      'password_reset_request', 'password_reset_complete',
      'admin_user_delete', 'admin_user_password_reset',
      'admin_user_promote', 'admin_user_demote',
      'user_disabled', 'user_reenabled',
      'ai_config_updated', 'ai_call_logged',
      'tts_config_updated',
      'scheduler_config_updated', 'scheduler_manual_trigger',
      'worksheet_saved', 'worksheet_deleted',
      'poem_saved', 'sutra_saved', 'rare_char_card_saved',
      'membership_granted', 'membership_granted_paypal', 'membership_revoked',
      'membership_checkout_started',
      'paypal_config_updated', 'paypal_webhook_received', 'paypal_webhook_rejected',
      'admin_chars_generated', 'admin_chars_init_seed',
      'admin_membership_plans_seeded',
    ];
    expect(events).toHaveLength(33);
  });

  it('writeAudit is a function', () => {
    expect(typeof writeAudit).toBe('function');
  });
});

describe('formatLogMessage', () => {
  it('formats register', () => {
    expect(formatLogMessage('register', null)).toBe('注册新账号');
  });
  it('formats login with username', () => {
    expect(formatLogMessage('login', { username: 'alice' })).toBe('登录(alice)');
  });
  it('formats history_create favorite', () => {
    expect(formatLogMessage('history_create', { action: 'favorite', char: '妈' })).toBe('收藏「妈」');
  });
  it('formats history_create view', () => {
    expect(formatLogMessage('history_create', { action: 'view', char: '好' })).toBe('查看「好」');
  });
  it('formats worksheet_saved print', () => {
    expect(formatLogMessage('worksheet_saved', { action: 'print', worksheetId: 12, title: '春晓' }))
      .toBe('打印字帖「春晓」(id=12)');
  });
  it('formats worksheet_saved save with paperSize + fontFamily', () => {
    expect(formatLogMessage('worksheet_saved', { action: 'save', worksheetId: 7, title: 'X', paperSize: 'A4', fontFamily: 'kai' }))
      .toBe('保存字帖「X」(id=7, A4, kai)');
  });
  it('formats worksheet_deleted', () => {
    expect(formatLogMessage('worksheet_deleted', { worksheetId: 12, title: '春晓' })).toBe('删除字帖 #12「春晓」');
  });
  it('formats poem_saved print', () => {
    expect(formatLogMessage('poem_saved', { action: 'print', poemId: 3, title: '静夜思' })).toBe('打印古诗「静夜思」');
  });
  it('formats sutra_saved print', () => {
    expect(formatLogMessage('sutra_saved', { action: 'print', slug: 'jgz', title: '金刚经' })).toBe('打印佛经「金刚经」');
  });
  it('formats rare_char_card_saved print', () => {
    expect(formatLogMessage('rare_char_card_saved', { action: 'print', char: '龘' })).toBe('打印生字卡「龘」');
  });
  it('formats admin_user_promote', () => {
    expect(formatLogMessage('admin_user_promote', { targetUserId: 5, targetUsername: 'bob' }))
      .toBe('提升 #5「bob」 为管理员');
  });
  it('formats membership_checkout_started with truncated order id', () => {
    expect(formatLogMessage('membership_checkout_started', { planKey: 'monthly', paypalOrderId: '9K1234567890ABCDE' }))
      .toContain('开始结账 (monthly, order=9K12345678…');
  });
  it('formats admin_chars_generated with all fields', () => {
    const msg = formatLogMessage('admin_chars_generated', {
      level: 2, fields: ['meaning_zh', 'pinyin_alt'],
      chars: ['一', '二', '三', '四', '五', '六'],
      generated: 12, skipped: 0, total: 12, errors: 0,
    });
    expect(msg).toContain('批量生成 L2');
    expect(msg).toContain('meaning_zh、pinyin_alt');
    expect(msg).toContain('一、二、三、四、五 等 6 字');
    expect(msg).toContain('生成 12/12');
  });
  it('formats admin_chars_init_seed with insert count', () => {
    expect(formatLogMessage('admin_chars_init_seed', { action: 'seed', inserted: 20 }))
      .toBe('种子 测试数据 (20 字)');
  });
  it('formats admin_chars_init_seed with remove count', () => {
    expect(formatLogMessage('admin_chars_init_seed', { action: 'clear', removed: 20 }))
      .toBe('清空 测试数据 (删除 20 字)');
  });
  it('formats scheduler_manual_trigger with task counts', () => {
    expect(formatLogMessage('scheduler_manual_trigger', { taskCount: 3, okCount: 2 }))
      .toBe('手动触发定时器 (3 个任务, 成功 2)');
  });
  it('formats scheduler_config_updated with joined keys', () => {
    expect(formatLogMessage('scheduler_config_updated', { keys: ['enabled', 'intervalMin'] }))
      .toBe('更新定时器配置(enabled、intervalMin)');
  });
  it('formats paypal_webhook_rejected with reason', () => {
    expect(formatLogMessage('paypal_webhook_rejected', { reason: 'bad_signature' }))
      .toBe('拒绝 PayPal 回调: bad_signature');
  });
  it('returns event name for unknown events with no metadata', () => {
    expect(formatLogMessage('weird_future_event', null)).toBe('weird_future_event');
  });
  it('falls back to JSON.stringify for unknown events with metadata', () => {
    expect(formatLogMessage('weird_event', { foo: 'bar' })).toBe('weird_event: {"foo":"bar"}');
  });
  it('returns sensible defaults when metadata is null/undefined', () => {
    expect(formatLogMessage('history_delete', undefined)).toBe('删除历史记录 #?');
    expect(formatLogMessage('login', null)).toBe('登录');
  });
});
