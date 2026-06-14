import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { LoginForm } from './LoginForm';

export default function LoginPage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <Suspense fallback={<div className="mt-8" />}>
          <LoginForm />
        </Suspense>
      </PageContainer>
      <Footer />
    </>
  );
}