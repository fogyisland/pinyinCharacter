import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { X } from 'lucide-react';

export default function MembershipCancelPage() {
  return (
    <>
      <Header />
      <main className="max-w-md mx-auto p-8 text-center space-y-4">
        <X className="h-12 w-12 mx-auto text-ink-soft" />
        <h1 className="font-kai text-xl">支付已取消</h1>
        <p className="text-sm text-ink-soft">您可以稍后再来。</p>
        <Link href="/membership" className="inline-block text-sm px-4 py-2 bg-ink text-paper rounded hover:bg-ink/80">返回套餐</Link>
      </main>
      <Footer />
    </>
  );
}
