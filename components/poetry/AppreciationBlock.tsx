interface Props {
  text: string;
}

export function AppreciationBlock({ text }: Props) {
  return (
    <section className="card-paper p-5 mt-6 border-l-4 border-seal">
      <h3 className="font-kai text-lg text-ink mb-2">赏析</h3>
      <p className="text-ink-soft leading-relaxed whitespace-pre-line text-sm">{text}</p>
    </section>
  );
}
