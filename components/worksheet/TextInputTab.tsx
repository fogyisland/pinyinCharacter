'use client';

interface Props {
  value: string[];
  onChange: (chars: string[]) => void;
}

const MAX_LEN = 500;

export function TextInputTab({ value, onChange }: Props) {
  const text = value.join('');
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          // 不在客户端过滤: React 19 之前的 controlled textarea 在 IME 组合中
          // 重设 value 会打断拼音输入, 表现就是"输一个字后剩下的进不去"。
          // 把验证完全交给服务端 saveWorksheetSchema, save 时如含非法字符会 400。
          const chars = Array.from(e.target.value);
          onChange(chars.length > MAX_LEN ? chars.slice(0, MAX_LEN) : chars);
        }}
        placeholder="输入或粘贴汉字,每个字一个格子..."
        rows={8}
        className="w-full rounded-md border border-ink/20 p-3 font-serif text-lg focus:border-seal focus:outline-none"
      />
      <p className="mt-2 text-xs text-ink-faint">
        {value.length} / 500 字
      </p>
    </div>
  );
}
