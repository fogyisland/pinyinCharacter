import Link from 'next/link';
import { RareChar } from '@/lib/rare-chars';

interface Props {
  data: RareChar;
}

export function RareCharDetail({ data }: Props) {
  return (
    <article className="mx-auto max-w-2xl">
      <header className="text-center">
        <div className="text-9xl font-bold text-gray-900">{data.char}</div>
        <div className="mt-4 text-3xl text-gray-700">{data.pinyin}</div>
      </header>

      <section className="mt-8 rounded-lg bg-gray-50 p-6">
        <h2 className="text-sm font-medium uppercase text-gray-500">释义</h2>
        <p className="mt-2 text-base text-gray-800">{data.meaning}</p>
      </section>

      <section className="mt-4 rounded-lg bg-yellow-50 p-6">
        <h2 className="text-sm font-medium uppercase text-gray-500">故事 / 例句</h2>
        <p className="mt-2 whitespace-pre-line text-base text-gray-800">{data.story}</p>
      </section>

      <div className="mt-8 text-center">
        <Link
          href={`/worksheet?prefill=${encodeURIComponent(data.char)}`}
          className="inline-block rounded-md bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
        >
          加入字帖 →
        </Link>
      </div>
    </article>
  );
}
