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