/**
 * Client-safe helpers for parsing the admin notification email list.
 *
 * Lives in its own file (separate from lib/notes.ts) so it has no server-only
 * imports (mysql2, etc.) and can be imported from both server and client
 * components, including components/admin/NotesEmailForm.tsx.
 */

export function parseNotesAdminEmails(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function isValidEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && s.length <= 254;
}