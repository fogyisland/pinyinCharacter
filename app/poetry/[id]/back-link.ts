// 2026-07-04: poetry detail page back-link. Mirrors the sutra
// getSutraBackLink pattern (app/sutra/[id]/back-link.ts) but accepts an
// arbitrary /poetry?... href instead of a fixed from-source enum, so the
// list page can pass through its own URL search string and the user
// returns to the same filtered view they came from.
//
// Security: the helper rejects any back value that does not start with
// `/poetry`. This blocks open-redirect via `?back=//evil.com` or
// `?back=http://evil.com` from a hand-crafted link.

export function getPoetryBackLink(
  back: string | undefined,
): { href: string; label: string } {
  // Strict boundary check: accept only the bare /poetry, or /poetry
  // followed by a path/query/fragment separator (/, ?, #). This blocks
  // /poetry-evil, //evil.com, and http://evil.com in one go.
  if (back && (back === '/poetry' || /^\/poetry(\/|\?|#|$)/.test(back))) {
    return { href: back, label: '返回诗词' };
  }
  return { href: '/poetry', label: '返回诗词' };
}