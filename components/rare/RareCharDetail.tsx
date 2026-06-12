import Link from 'next/link';
import { RareChar } from '@/lib/rare-chars';

interface Props {
  data: RareChar;
}

export function RareCharDetail({ data }: Props) {
  return (
    <article className="mx-auto max-w-2xl">
      <header className="text-center">
        <div className="text-9xl font-bold text-ink">{data.char}</div>
        <div className="mt-4 text-3xl text-ink-soft">{data.pinyin}</div>
      </header>

      <section className="mt-8 rounded-lg bg-paper-deep p-6">
        <h2 className="text-sm font-medium uppercase text-ink-faint">释义</h2>
        <p className="mt-2 text-base text-ink">{data.meaning}</p>
      </section>

      <section className="mt-4 rounded-lg bg-paper-deep p-6 border-l-4 border-seal pl-6">
        <h2 className="text-sm font-medium uppercase text-ink-faint">故事 / 例句</h2>
        <p className="mt-2 whitespace-pre-line text-base text-ink">{data.story}</p>
      </section>

      <div className="mt-8 text-center">
        <Link
          href={`/worksheet?prefill=${encodeURIComponent(data.char)}`}
          className="inline-block rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80"
        >
          加入字帖 →
        </Link>
      </div>
    </article>
  );
}
