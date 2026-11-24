import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { buildMetadata } from '@/lib/seo/metadata';
import pairs from '@/data/duiyun-pairs.json';
import type { DuiyunPair } from '@/lib/duiyun-rules';
import { ProsodyWorkbench } from './ProsodyWorkbench';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '声律谱系与格律案头 · 字·韵',
    description:
      '平水韵平声三十部全谱、761 副《声律启蒙》《笠翁对韵》逐字平仄检索、近体诗平仄格律校验与楹联对仗席。',
    path: '/prosody',
    ogType: 'website',
  });
}

export default function ProsodyPage() {
  const typedPairs = pairs as readonly DuiyunPair[];

  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <header className="publication-heading">
          <div className="mb-2 font-kai text-sm tracking-widest text-seal">
            上平十五韵 · 下平十五韵 · 七百六十一对
          </div>
          <h1>声律 · 平水韵与近体格律案头</h1>
          <p>
            传统诗文之声律，以四声（平、上、去、入）分平仄，以《平水韵》定韵部，以粘对、替失成格律。本案头汇集平声三十部对韵谱系、近体诗平仄校验器与楹联对仗席，可随查韵目、逐字勘律、直通原典。
          </p>
        </header>

        {/* 四声与格律法度提要 */}
        <section
          aria-label="声律法度纲要"
          className="mb-10 grid gap-4 border-b border-ink/20 pb-8 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="border-t-2 border-ink/35 bg-paper-soft p-5">
            <span className="text-xs tracking-widest text-seal">一 · 四声平仄</span>
            <h2 className="mt-1 font-kai text-2xl text-ink">平声悠长，仄声峭拔</h2>
            <p className="mt-2 text-sm leading-7 text-ink-soft">
              中古四声以<strong>平声</strong>（今阴平、阳平）为平，以<strong>上、去、入</strong>
              三声为仄。古入声字收 -p、-t、-k
              促音，今派入四声（如“白、日、竹、石、一”在古体与近体格律中皆属仄声）。
            </p>
          </div>

          <div className="border-t-2 border-ink/35 bg-paper-soft p-5">
            <span className="text-xs tracking-widest text-seal">二 · 平水韵部</span>
            <h2 className="mt-1 font-kai text-2xl text-ink">平声三十，百六全韵</h2>
            <p className="mt-2 text-sm leading-7 text-ink-soft">
              金代王文郁、宋末刘渊并《广韵》二百六部为<strong>平水韵一百零六部</strong>
              。近体诗以押平声韵为常轨，故《声律启蒙》《笠翁对韵》皆依
              <strong>上平十五韵、下平十五韵</strong>编次。
            </p>
          </div>

          <div className="border-t-2 border-ink/35 bg-paper-soft p-5">
            <span className="text-xs tracking-widest text-seal">三 · 近体粘对</span>
            <h2 className="mt-1 font-kai text-2xl text-ink">一三五不论，二四六分明</h2>
            <p className="mt-2 text-sm leading-7 text-ink-soft">
              每句二、四、六字为<strong>节奏眼</strong>
              ：句内交替（平仄相间），联内相对（出句与对句平仄相反），联间相粘（后联出句与前联对句第二字平仄相同），忌犯孤平与三平调。
            </p>
          </div>

          <div className="border-t-2 border-ink/35 bg-paper-soft p-5">
            <span className="text-xs tracking-widest text-seal">四 · 属对之法</span>
            <h2 className="mt-1 font-kai text-2xl text-ink">虚实相当，上仄下平</h2>
            <p className="mt-2 text-sm leading-7 text-ink-soft">
              属对由一字至十字：天文对地理，花木对鸟兽，颜色对数目。成联须守
              <strong>上联仄收、下联平收</strong>，平声收尾方显余音绕梁。
            </p>
          </div>
        </section>

        {/* 声律交互工作台 */}
        <Suspense fallback={null}>
          <ProsodyWorkbench pairs={typedPairs} />
        </Suspense>

        {/* 原典与实操跳转 */}
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-ink/25 pt-6 text-sm">
          <div className="flex flex-wrap gap-5">
            <Link
              href="/ancient/shenglv-qimeng-1"
              className="text-seal underline underline-offset-4"
            >
              《声律启蒙·上卷》原典
            </Link>
            <Link
              href="/ancient/shenglv-qimeng-2"
              className="text-seal underline underline-offset-4"
            >
              《声律启蒙·下卷》原典
            </Link>
            <Link
              href="/ancient/liweng-duiyun-1"
              className="text-seal underline underline-offset-4"
            >
              《笠翁对韵·上卷》原典
            </Link>
            <Link
              href="/ancient/liweng-duiyun-2"
              className="text-seal underline underline-offset-4"
            >
              《笠翁对韵·下卷》原典
            </Link>
          </div>
          <Link href="/poetry" className="text-ink-soft hover:text-seal">
            去古诗词库按体裁与朝代检验诗作 →
          </Link>
        </footer>
      </PageContainer>
      <Footer />
    </>
  );
}
