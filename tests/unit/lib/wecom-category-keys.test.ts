import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('every notification carries a category', () => {
  it('the password reset mail carries the password_reset category', () => {
    // Without a category a notification cannot be matched against the
    // groups' checkboxes, so it can never be forwarded.
    const source = readSource('app/api/auth/forgot/route.ts');
    expect(source).toContain("template: 'password_reset'");
  });

  it('the admin test mail carries the email_test category', () => {
    const source = readSource('app/api/admin/email/test/route.ts');
    expect(source).toContain("template: 'email_test'");
  });
});
