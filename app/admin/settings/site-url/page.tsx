import { getConfig } from '@/lib/config';
import { getSiteUrl } from '@/lib/seo/config';
import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { SiteUrlForm } from '@/components/admin/SiteUrlForm';

export const dynamic = 'force-dynamic';

export default async function AdminSiteUrlPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') redirect('/?auth=login');
    redirect('/?error=forbidden');
  }
  const override = await getConfig('site.url');
  const url = override && override.length > 0 ? override : getSiteUrl();
  const source: 'app_config' | 'env' = override && override.length > 0 ? 'app_config' : 'env';
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">站点设置</h1>
      <p className="text-sm text-ink-soft max-w-2xl">
        设置站点的对外 URL(例如 <code>https://pinyin.example.com</code>)。
        写入 <code>app_config.site.url</code> 后, sitemap、robots、canonical 链接、JSON-LD 都会使用这个值,
        避免外部爬虫看到 <code>localhost:3000</code>。
      </p>
      <SiteUrlForm initial={{ url, source }} />
    </div>
  );
}
