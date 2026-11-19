/**
 * The profile page must offer a way to change the password.
 *
 * Before this existed the only ways to change a password were the
 * forgot-password email flow and an admin resetting it. Both need
 * something the user may not have: access to the mailbox, or admin
 * rights.
 *
 * The card has to make the "current password" obvious - it is not
 * optional, the API rejects the request without it - and it has to say
 * what happens afterwards: the session is dropped, so the user signs in
 * again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

const CARD = 'components/profile/ChangePasswordCard.tsx';
const PROFILE = 'app/profile/page.tsx';

describe('the change-password card', () => {
  it('exists', () => {
    expect(() => readSource(CARD)).not.toThrow();
  });

  it('is a client component', () => {
    expect(readSource(CARD)).toContain("'use client'");
  });

  it('asks for the current password, not just the new one', () => {
    const source = readSource(CARD);
    expect(source, 'the card must ask for the current password').toContain(
      'currentPassword',
    );
    expect(source, 'the card must ask for the new password').toContain('newPassword');
  });

  it('posts to the change-password endpoint', () => {
    expect(readSource(CARD)).toContain('/api/auth/change-password');
  });

  it('tells the user they have to sign in again', () => {
    const source = readSource(CARD);
    expect(
      source,
      'the card must tell the user the session ends and they sign in again',
    ).toMatch(/重新登录|再次登录|再登录/);
  });

  it('never renders the password in plain text', () => {
    // A password field must be type="password" - a plain input would put
    // the password on screen and into a shoulder-surfer's view.
    const source = readSource(CARD);
    const inputs = [...source.matchAll(/<input[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(inputs.length, 'the card must have input fields').toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input, 'every password input must be type="password"').toContain(
        'type="password"',
      );
    }
  });

  it('is mounted on the profile page', () => {
    const source = readSource(PROFILE);
    expect(source, 'the profile page must mount the card').toContain(
      'ChangePasswordCard',
    );
  });
});
