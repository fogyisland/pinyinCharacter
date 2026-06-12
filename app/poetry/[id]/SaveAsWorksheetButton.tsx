'use client';

interface Props {
  id: number;
  title: string;
  author: string;
  content: string[];
}

export function SaveAsWorksheetButton({ id, title, author, content }: Props) {
  return (
    <button
      type="button"
      disabled
      className="rounded-md bg-seal/60 px-5 py-2 text-white cursor-not-allowed"
    >
      保存到字帖 (TODO)
    </button>
  );
}
