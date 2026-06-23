import { redirect } from 'next/navigation';

// 旧版 /admin/audit 现在重定向到统一的 /admin/logs (Plan H9 合并了 audit +
// download + ai_call 三个数据源,新页面支持 source/event/ip 等过滤)。
export default function AdminAuditRedirect() {
  redirect('/admin/logs');
}