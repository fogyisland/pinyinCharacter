import { getConfig } from '@/lib/config';
import { getSiteUrl } from '@/lib/seo/config';
import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { SiteUrlForm } from '@/components/admin/SiteUrlForm';
import { PageHeader } from '@/components/admin/PageHeader';

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
    <div>
      <PageHeader
        title="站点设置"
        description="设置站点的对外 URL(例如 https://pinyin.example.com)。写入 app_config.site.url 后, sitemap、robots、canonical 链接、JSON-LD 都会使用这个值, 避免外部爬虫看到 localhost:3000。"
      />
      <SiteUrlForm initial={{ url, source }} />
    </div>
  );
}
