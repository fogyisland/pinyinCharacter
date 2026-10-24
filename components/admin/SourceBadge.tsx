import { StatusBadge, type BadgeTone } from './StatusBadge';

/**
 * The badge that says where a log line came from.
 *
 * The three sources map onto the shared badge tones, so a log line reads
 * the same way as every other status pill in the admin. The old markup
 * used `bg-scroll/20`, a colour token that no longer exists — the tint
 * never rendered and the badge fell back to the page background.
 */
const SOURCE_TONE: Record<'audit' | 'download' | 'ai_call', BadgeTone> = {
  audit: 'neutral',
  download: 'info',
  ai_call: 'primary',
};

const SOURCE_LABEL: Record<'audit' | 'download' | 'ai_call', string> = {
  audit: '审计',
  download: '下载',
  ai_call: 'AI 调用',
};

export function SourceBadge({ source }: { source: 'audit' | 'download' | 'ai_call' }) {
  return (
    <StatusBadge tone={SOURCE_TONE[source]}>{SOURCE_LABEL[source]}</StatusBadge>
  );
}
