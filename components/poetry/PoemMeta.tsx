import type { Dynasty } from '@/lib/poetry-types';

interface Props {
  title: string;
  author: string;
  dynasty: Dynasty;
  form?: string | null;
}

const DYNASTY_LABEL: Record<Dynasty, string> = { tang: '唐', song: '宋' };

export function PoemMeta({ title, author, dynasty, form }: Props) {
  return (
    <header className="text-center mb-6">
      <div className="paper-rule w-16 mx-auto mb-4" />
      <h1 className="font-kai text-3xl sm:text-4xl text-ink leading-tight">《{title}》</h1>
      <p className="mt-3 text-ink-soft text-base">
        <span className="inline-block px-2 py-0.5 mr-2 bg-seal/10 text-seal text-xs font-medium rounded">
          {DYNASTY_LABEL[dynasty]}
        </span>
        {author}
        {form && <span className="text-ink-faint text-sm ml-2">· {form}</span>}
      </p>
      <div className="paper-rule w-16 mx-auto mt-4" />
    </header>
  );
}
