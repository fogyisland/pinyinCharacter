import { Header } from '@/components/Header';
import { TextToPinyin } from '@/components/TextToPinyin';
import { PinyinInputMethod } from '@/components/PinyinInputMethod';
import { PinyinFullSentence } from '@/components/PinyinFullSentence';

export default function Home() {
  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <TextToPinyin />

        <section className="bg-white border rounded-lg p-4 space-y-3">
          <h2 className="text-base font-semibold">拼音 → 汉字</h2>
          <details open className="border rounded p-3">
            <summary className="cursor-pointer font-medium">输入码点选</summary>
            <div className="mt-3">
              <PinyinInputMethod />
            </div>
          </details>
          <details className="border rounded p-3">
            <summary className="cursor-pointer font-medium">整句转换</summary>
            <div className="mt-3">
              <PinyinFullSentence />
            </div>
          </details>
        </section>
      </main>
    </>
  );
}
