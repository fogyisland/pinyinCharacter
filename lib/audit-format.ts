/**
 * Client-safe audit-event metadata formatter.
 *
 * Lives in its own file (separate from lib/audit.ts) so it has no server-only
 * imports (next/server, mysql2, etc.) and can be imported from both server
 * and client components, including /admin/logs.
 */

export type AuditEvent =
  | 'register' | 'login' | 'logout'
  | 'history_create' | 'history_delete'
  | 'password_reset_request' | 'password_reset_complete'
  | 'admin_user_delete' | 'admin_user_password_reset'
  | 'admin_user_promote' | 'admin_user_demote'
  | 'user_disabled' | 'user_reenabled'
  | 'ai_config_updated' | 'ai_call_logged'
  | 'tts_config_updated'
  | 'scheduler_config_updated' | 'scheduler_manual_trigger'
  | 'worksheet_saved' | 'worksheet_char_appended' | 'worksheet_deleted' | 'worksheet_batch_printed'
  | 'poem_saved' | 'sutra_saved' | 'rare_char_card_saved'
  | 'membership_granted' | 'membership_granted_paypal' | 'membership_revoked'
  | 'membership_checkout_started'
  | 'paypal_config_updated' | 'paypal_webhook_received' | 'paypal_webhook_rejected'
  | 'admin_chars_generated' | 'admin_chars_init_seed'
  | 'admin_membership_plans_seeded'
  | 'admin_about_intro_regenerated'
  | 'smtp_config_updated' | 'smtp_test_sent';

/**
 * Format an audit event + metadata into a short Chinese sentence for display
 * in the admin log UI. Keep one branch per event so changes stay localized.
 */
export function formatLogMessage(event: string, metadata: Record<string, unknown> | null | undefined): string {
  const m = metadata ?? {};
  const num = (v: unknown, suffix = ''): string =>
    typeof v === 'number' ? `${v}${suffix}` : typeof v === 'string' ? `${v}${suffix}` : '';
  const str = (v: unknown): string => (typeof v === 'string' && v ? v : '');
  const join = (arr: unknown[]): string => arr.filter((x) => typeof x === 'string' && x).join('、');

  switch (event) {
    case 'register':              return '注册新账号';
    case 'login':                 return `登录${str(m.username) ? `(${str(m.username)})` : ''}`;
    case 'logout':                return '退出登录';
    case 'history_create': {
      const action = str(m.action) === 'favorite' ? '收藏' : str(m.action) === 'view' ? '查看' : '记录';
      const char = str(m.char) || str(m.word) || '?';
      return `${action}「${char}」`;
    }
    case 'history_delete':        return `删除历史记录 #${num(m.id) || str(m.id) || '?'}`;
    case 'password_reset_request':  return `请求重置密码${str(m.email) ? `(${str(m.email)})` : ''}`;
    case 'password_reset_complete': return '完成密码重置';

    case 'admin_user_delete':       return `删除用户 #${num(m.targetUserId) || '?'}${str(m.targetUsername) ? `「${str(m.targetUsername)}」` : ''}`;
    case 'admin_user_password_reset': return `重置用户 #${num(m.targetUserId) || '?'} 的密码${str(m.targetUsername) ? `「${str(m.targetUsername)}」` : ''}`;
    case 'admin_user_promote':      return `提升 #${num(m.targetUserId) || '?'}${str(m.targetUsername) ? `「${str(m.targetUsername)}」` : ''} 为管理员`;
    case 'admin_user_demote':        return `降级 #${num(m.targetUserId) || '?'}${str(m.targetUsername) ? `「${str(m.targetUsername)}」` : ''} 为普通用户`;
    case 'user_disabled':           return `禁用用户 #${num(m.targetUserId) || '?'}${str(m.targetUsername) ? `「${str(m.targetUsername)}」` : ''}`;
    case 'user_reenabled':          return `重新启用用户 #${num(m.targetUserId) || '?'}${str(m.targetUsername) ? `「${str(m.targetUsername)}」` : ''}`;

    case 'ai_config_updated':       return `更新 AI 配置${Array.isArray(m.keys) && m.keys.length ? `(${join(m.keys as string[])})` : ''}`;
    case 'ai_call_logged':          return `AI 调用: ${str(m.feature) || '?'}`;

    case 'tts_config_updated':      return `更新 TTS 配置${Array.isArray(m.keys) && m.keys.length ? `(${join(m.keys as string[])})` : ''}`;

    case 'scheduler_config_updated': return `更新定时器配置${Array.isArray(m.keys) && m.keys.length ? `(${join(m.keys as string[])})` : ''}`;
    case 'scheduler_manual_trigger': return `手动触发定时器 (${num(m.taskCount) || '?'} 个任务, 成功 ${num(m.okCount) || '?'})`;

    case 'worksheet_saved': {
      const action = str(m.action) === 'print' ? '打印字帖' : '保存字帖';
      return `${action}「${str(m.title) || '(无标题)'}」(id=${num(m.worksheetId) || '?'}${str(m.paperSize) ? `, ${str(m.paperSize)}` : ''}${str(m.fontFamily) ? `, ${str(m.fontFamily)}` : ''})`;
    }
    case 'worksheet_char_appended':
      return `${m.added === false ? '已存在' : '追加'}「${str(m.char) || '?'}」到「我的字帖」 (#${num(m.worksheetId) || '?'})`;
    case 'worksheet_deleted':       return `删除字帖 #${num(m.worksheetId) || num(m.id) || '?'}${str(m.title) ? `「${str(m.title)}」` : ''}`;
    case 'worksheet_batch_printed': return `批量打印 ${num(m.count) || '?'} 张字帖 (${Array.isArray(m.ids) ? m.ids.map(String).join(', ') || '?' : '?'})`;
    case 'poem_saved': {
      const action = str(m.action) === 'print' ? '打印古诗' : '保存古诗';
      return `${action}「${str(m.title) || str(m.poemId) || '?'}」`;
    }
    case 'sutra_saved': {
      const action = str(m.action) === 'print' ? '打印佛经' : '保存佛经';
      return `${action}「${str(m.title) || str(m.slug) || '?'}」`;
    }
    case 'rare_char_card_saved': {
      const action = str(m.action) === 'print' ? '打印生字卡' : '保存生字卡';
      return `${action}「${str(m.char) || '?'}」`;
    }

    case 'membership_granted':         return `管理员开通会员 #${num(m.targetUserId) || '?'}${str(m.targetUsername) ? `「${str(m.targetUsername)}」` : ''} (${str(m.plan) || '?'})`;
    case 'membership_granted_paypal':  return `PayPal 开通会员 #${num(m.targetUserId) || '?'} (${str(m.plan) || '?'})`;
    case 'membership_revoked':         return `撤销会员 #${num(m.targetUserId) || '?'}${str(m.targetUsername) ? `「${str(m.targetUsername)}」` : ''}`;
    case 'membership_checkout_started':return `开始结账 (${str(m.planKey) || '?'}${str(m.paypalOrderId) ? `, order=${str(m.paypalOrderId).slice(0, 10)}…` : ''})`;

    case 'paypal_config_updated':      return '更新 PayPal 配置';
    case 'paypal_webhook_received':    return `收到 PayPal 回调${str(m.eventType) ? ` (${str(m.eventType)})` : ''}`;
    case 'paypal_webhook_rejected':    return `拒绝 PayPal 回调: ${str(m.reason) || '?'}`;

    case 'admin_chars_generated': {
      const lvl = num(m.level);
      const chars = Array.isArray(m.chars) ? m.chars : [];
      const fields = Array.isArray(m.fields) ? m.fields : [];
      const total = num(m.total);
      const generated = num(m.generated);
      const skipped = num(m.skipped);
      const errs = num(m.errors);
      const head = join(chars.slice(0, 5) as string[]);
      const more = chars.length > 5 ? ` 等 ${chars.length} 字` : '';
      return `批量生成${lvl ? ` L${lvl}` : ''} 字段 ${join(fields as string[])} — 字符: ${head}${more} — 生成 ${generated}/${total} (跳过 ${skipped}, 错误 ${errs})`;
    }
    case 'admin_chars_init_seed':
      return `${str(m.action) === 'clear' ? '清空' : '种子'} 测试数据${num(m.inserted) ? ` (${num(m.inserted)} 字)` : num(m.removed) ? ` (删除 ${num(m.removed)} 字)` : ''}`;

    case 'admin_membership_plans_seeded': return `种子会员套餐 (${num(m.seeded) || '?'} 个)`;
    case 'admin_about_intro_regenerated': return `重新生成关于页介绍 (${num(m.charCount) || '?'} 字, ${num(m.durationMs) || '?'}ms, ${str(m.model) || '?'})`;

    case 'smtp_config_updated':
      return `更新邮件配置${Array.isArray(m.keys) && m.keys.length ? `(${join(m.keys as string[])})` : ''}`;
    case 'smtp_test_sent':
      return `测试邮件发送 (to=${str(m.to) || '?'}, ok=${m.ok === true ? 'true' : m.ok === false ? 'false' : '?'}${str(m.error) ? `, error=${str(m.error)}` : ''})`;

    default: {
      const keys = Object.keys(m);
      if (keys.length === 0) return event;
      return `${event}: ${JSON.stringify(m)}`;
    }
  }
}
