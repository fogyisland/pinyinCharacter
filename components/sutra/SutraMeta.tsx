interface Props {
  title: string;
  chunkLabel?: string | null;
}

export function SutraMeta({ title, chunkLabel }: Props) {
  return (
    <div className="text-center my-6">
      <div className="paper-rule mb-3" />
      <h1 className="font-kai text-3xl text-ink">《{title}》</h1>
      {chunkLabel && (
        <p className="text-sm text-ink-soft mt-2">{chunkLabel}</p>
      )}
      <div className="paper-rule mt-3" />
    </div>
  );
}
