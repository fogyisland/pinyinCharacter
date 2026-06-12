'use client';

interface Props {
  q: string;
  onQChange: (q: string) => void;
}

export function SutraSearch({ q, onQChange }: Props) {
  return (
    <input
      type="search"
      value={q}
      onChange={(e) => onQChange(e.target.value)}
      placeholder="搜索经名..."
      className="w-full rounded-md border border-ink/20 bg-paper-soft px-3 py-2 text-base focus:border-seal focus:outline-none"
    />
  );
}
