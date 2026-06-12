import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { ForgotForm } from './ForgotForm';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="max-w-sm mx-auto card-paper p-6 mt-8">
          <div className="font-kai text-center text-ink-faint tracking-[0.3em] text-xs mb-4">字 · 韵</div>
          <h1 className="font-kai text-2xl text-center text-ink mb-2">忘记密码</h1>
          <div className="paper-rule w-12 mx-auto mb-6" />
          <p className="text-sm text-ink-soft mb-4">输入你的用户名,我们会发送一封重置链接到你的注册邮箱。</p>
          <ForgotForm />
          <p className="text-xs text-ink-faint mt-4">
            想起密码了? <a href="/?auth=login" className="text-seal hover:underline">返回登录</a>
          </p>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
