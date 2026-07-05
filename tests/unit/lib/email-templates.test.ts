// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { notesNotificationEmail } from '../../../lib/email-templates';

describe('notesNotificationEmail', () => {
  it('subject includes note id + author', () => {
    const out = notesNotificationEmail({
      id: 42, authorName: '张三', authorEmail: 'a@b.com',
      content: '你好', createdAt: new Date('2026-07-05T08:00:00Z'), ip: '1.2.3.4',
    });
    expect(out.subject).toBe('[留言笔记] 新留言 #42 — 张三');
  });

  it('escapes HTML in author name + content', () => {
    const out = notesNotificationEmail({
      id: 1, authorName: '<script>', authorEmail: null,
      content: '<img src=x>', createdAt: new Date(), ip: null,
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).not.toContain('<img src=x>');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).toContain('&lt;img src=x&gt;');
  });

  it('omits email line when authorEmail is null', () => {
    const out = notesNotificationEmail({
      id: 1, authorName: '匿名', authorEmail: null,
      content: 'x', createdAt: new Date(), ip: null,
    });
    expect(out.html).not.toContain('@');
    expect(out.text).not.toContain('@');
  });
});