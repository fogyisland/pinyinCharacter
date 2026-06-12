import { listUsers } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const { users, total } = await listUsers({ limit: 200, offset: 0 });
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">用户管理 (共 {total})</h1>
      <div className="card-paper rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep text-left">
            <tr>
              <th className="px-3 py-2">用户名</th>
              <th className="px-3 py-2">注册时间</th>
              <th className="px-3 py-2">历史</th>
              <th className="px-3 py-2">收藏</th>
              <th className="px-3 py-2">角色</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2">{u.username}</td>
                <td className="px-3 py-2 text-ink-soft">{new Date(u.createdAt).toLocaleString('zh-CN')}</td>
                <td className="px-3 py-2">{u.historyCount}</td>
                <td className="px-3 py-2">{u.favoriteCount}</td>
                <td className="px-3 py-2">
                  {u.isAdmin
                    ? <span className="text-xs px-2 py-0.5 rounded bg-seal/15 text-seal">管理员</span>
                    : <span className="text-xs text-ink-faint">用户</span>}
                </td>
                <td className="px-3 py-2">
                  <a href={`/admin/users/${u.id}`} className="text-seal hover:underline">详情 →</a>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-faint">暂无用户</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
