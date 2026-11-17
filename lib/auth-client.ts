export function validateUsername(s: string): string | null {
  if (s.length < 3 || s.length > 32) return '用户名长度需 3-32 字符';
  if (!/^[a-zA-Z0-9_\-]+$/.test(s)) return '用户名只能含字母、数字、下划线、连字符';
  return null;
}

export function validatePassword(s: string): string | null {
  if (s.length < 8) return '密码至少 8 位';
  if (s.length > 72) return '密码不能超过 72 位';
  return null;
}

/** 客户端再次输入密码校验（服务端仍是 source of truth） */
export function validatePasswordConfirmation(pw: string, confirm: string): string | null {
  if (pw !== confirm) return '两次输入不一致';
  return null;
}

/**
 * Constrain a post-login redirect target to this site.
 *
 * The login page reads `?next=` and hands it to `router.push()`. Next.js
 * treats a target whose origin differs from the current one as an
 * EXTERNAL navigation (`location.assign`), so an unchecked `?next=` sent
 * the user off-site the moment they logged in:
 *
 *   https://victim/login?next=https://evil.example/phish
 *
 * The victim sees a genuine login page, types their real password, and is
 * then bounced to the attacker's site — a phishing amplifier that borrows
 * the site's credibility.
 *
 * The rule: the target must be a path that starts with a single `/`.
 * That rejects absolute URLs (`https://…`), protocol-relative URLs
 * (`//evil.example`, which the browser reads as another host) and
 * scheme-bearing values (`javascript:…`). A backslash is rejected too:
 * some browsers normalise `/\evil.example` to `//evil.example`.
 *
 * Anything rejected falls back to `/`.
 */
export function safeInternalPath(next: string | null | undefined): string {
  if (!next) return '/';
  if (!next.startsWith('/')) return '/';
  // `//host` and `/\host` are both "another origin" to a browser.
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
