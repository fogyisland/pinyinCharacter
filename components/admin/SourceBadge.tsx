const COLORS: Record<string, string> = {
  audit: 'bg-ink/10 text-ink',
  download: 'bg-scroll/20 text-ink',
  ai_call: 'bg-seal/10 text-seal',
};
export function SourceBadge({ source }: { source: 'audit' | 'download' | 'ai_call' }) {
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${COLORS[source]}`}>{source}</span>;
}
