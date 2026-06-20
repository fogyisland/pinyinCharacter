interface Props {
  content: string[];
  fontFamily?: string;
}

// 标点字符 — 用作断句标记,加 seal 色 + 略宽 margin 让节拍清晰
const PUNCT_RE = /[，。！？、；：""''「」『』《》（）·]/;

export function PoemTextView({ content, fontFamily }: Props) {
  return (
    <div
      className="text-2xl sm:text-3xl text-ink leading-loose text-center tracking-wide"
      style={fontFamily ? { fontFamily } : undefined}
    >
      {content.map((line, lineIdx) => (
        <p key={lineIdx} className="my-2">
          {Array.from(line).map((c, i) => (
            <span
              key={i}
              className={PUNCT_RE.test(c) ? 'mx-1.5 text-seal' : ''}
            >
              {c}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
