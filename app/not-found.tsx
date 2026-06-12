import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';

export default function NotFound() {
  return (
    <>
      <Header />
      <PageContainer>
        <div className="text-center py-16">
          <div className="font-kai text-[160px] sm:text-[200px] text-ink/15 leading-none">无</div>
          <div className="stamp inline-block mt-4">404</div>
          <p className="text-ink-soft mt-6 mb-2">页面不存在，或已被移走</p>
          <p className="text-sm text-ink-faint mb-8">Not Found</p>
          <Link href="/" className="btn-seal">返回首页</Link>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
