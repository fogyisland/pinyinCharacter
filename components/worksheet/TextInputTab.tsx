'use client';

interface Props {
  value: string[];
  onChange: (chars: string[]) => void;
}

export function TextInputTab({ value, onChange }: Props) {
  const text = value.join('');
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          const filtered = Array.from(e.target.value)
            .filter((c) => /[一-鿿]/.test(c))
            .slice(0, 500);
          onChange(filtered);
        }}
        placeholder="输入或粘贴汉字,每个字一个格子..."
        rows={8}
        className="w-full rounded-md border border-gray-300 p-3 font-serif text-lg focus:border-blue-500 focus:outline-none"
      />
      <p className="mt-2 text-xs text-gray-500">
        {value.length} / 500 字
      </p>
    </div>
  );
}
