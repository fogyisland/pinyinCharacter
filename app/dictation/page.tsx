import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';
import { DictationClient } from './DictationClient';
import { Header } from '@/components/Header';

export const dynamic = 'force-dynamic';

/**
 * The dictation tool: 出卷 (build and print the paper) and 报听写 (the
 * classroom runner), sharing one item draft.
 *
 * The interactive half lives in `DictationClient` because this file must
 * stay a server component: Next.js only reads `generateMetadata` on the
 * server, and a `'use client'` page cannot export it. Swapping the two
 * would put this route back on the layout's generic title with no
 * canonical — which is what the SEO scan found.
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '听写练习 — 出卷 · 报听写 · 打印 | 字·韵',
    description:
      '按 HSK 等级或成语选词，自动注音，生成听写卷与答案页；也能在课堂上逐条报听写，支持 5/8/12 秒自动间隔。',
    path: '/dictation',
    ogType: 'website',
  });
}

export default function DictationPage() {
  return <><div className="worksheet-no-print print:hidden"><Header /></div><DictationClient /></>;
}
