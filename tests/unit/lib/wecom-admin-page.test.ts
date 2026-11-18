import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('the WeCom admin page', () => {
  it('exists', () => {
    expect(() => readSource('app/admin/wecom/page.tsx')).not.toThrow();
  });

  it('is reachable from the admin sidebar', () => {
    const sidebar = readSource('components/admin/AdminSidebar.tsx');
    expect(sidebar).toContain('/admin/wecom');
  });

  it('is dynamic — the group list is read per request', () => {
    // The groups change in the database, not at build time.
    expect(readSource('app/admin/wecom/page.tsx')).toContain("dynamic = 'force-dynamic'");
  });

  it('warns that the forwarding needs the scheduler', () => {
    // The delivery task runs in the scheduler tick. If the scheduler is
    // off, the messages queue up and never leave. The admin has to know.
    const page = readSource('app/admin/wecom/page.tsx');
    expect(page).toContain('scheduler');
  });

  it('offers a checkbox for every category', () => {
    const form = readSource('components/admin/WecomWebhookForm.tsx');
    expect(form).toContain('WECOM_CATEGORIES');
    expect(form).toContain('WECOM_CATEGORY_LABELS');
  });

  it('shows the webhook URL in the clear', () => {
    // The product decision: the admin sees the URL. It is not masked.
    const form = readSource('components/admin/WecomWebhookForm.tsx');
    expect(form).toContain('webhookUrl');
  });
});
