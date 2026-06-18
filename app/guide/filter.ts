const BLOCKED_H2_SECTIONS = [
  '## 启动',
  '## 测试',
  '## 管理员后台扩展',
  '## 环境变量',
] as const;

/**
 * Drop H2 sections that are admin/deployment-only from the README so that
 * the public /guide page shows only user-facing content. Matching is exact
 * text — keep the blocklist short and obvious.
 */
export function filterUserReadme(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let skip = false;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      skip = BLOCKED_H2_SECTIONS.some((prefix) => line.startsWith(prefix));
    }
    if (!skip) out.push(line);
  }
  return out.join('\n');
}
