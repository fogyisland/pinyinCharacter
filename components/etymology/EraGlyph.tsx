import type { Era } from '@/lib/etymology-types';

const ERA_LABELS: Record<Era, string> = {
  jiaguwen: '甲骨文',
  jinwen: '金文',
  xiaozhuan: '小篆',
  lishu: '隶书',
  kaishu: '楷书',
};

const ERA_FONT_CLASS: Record<Era, string> = {
  jiaguwen: 'font-jiaguwen',
  jinwen: 'font-jinwen',
  xiaozhuan: 'font-xiaozhuan',
  lishu: 'font-lishu',
  kaishu: 'font-kai',
};

interface Props {
  char: string;
  era: Era;
  font: string;
  hasGlyph: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function EraGlyph({ char, era, hasGlyph, size = 'md' }: Props) {
  const sizeClass =
    size === 'lg' ? 'text-7xl' : size === 'sm' ? 'text-2xl' : 'text-4xl';
  if (!hasGlyph) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div
          className={`${sizeClass} text-ink-faint border border-dashed border-ink/20 rounded flex items-center justify-center aspect-square w-20`}
        >
          暂无
        </div>
        <div className="text-xs text-ink-faint">{ERA_LABELS[era]}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`${sizeClass} ${ERA_FONT_CLASS[era]} text-ink`}>{char}</span>
      <div className="text-xs text-ink-faint">{ERA_LABELS[era]}</div>
    </div>
  );
}
