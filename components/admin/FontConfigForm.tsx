'use client';

import { useState } from 'react';
import { ERAS, type Era } from '@/lib/etymology-types';

// NOTE: Mirrors lib/era-fonts.ts. We cannot import from lib/era-fonts.ts here
// because it transitively pulls in mysql2 via getAllConfig, which webpack
// cannot bundle into a client chunk. The RSC page always passes an explicit
// initial prop; these constants are only used as a fallback (e.g. unit tests)
// and to determine the "非默认" indicator under each dropdown.

interface EraFontOption {
  id: string;
  label: string;
  desc: string;
}

const ERA_FONTS: Record<Era, EraFontOption[]> = {
  jiaguwen: [
    { id: 'Oracular',         label: 'Oracular (默认)',         desc: '32MB, 甲骨文, 1531 BMP chars' },
    { id: 'OracularInverted', label: 'Oracular 阴文',           desc: '白底黑字, 类似真实甲骨' },
    { id: 'YinQiJiaGuWen',    label: 'Founder 甲骨文',          desc: '方正甲骨文, 旧默认, 2.7MB' },
  ],
  jinwen: [
    { id: 'WangHanzongWeibei', label: '王汉宗魏碑 (默认)',     desc: '10MB, 魏碑 ≈ 金文风格' },
    { id: 'HanDianJinWen',     label: 'BabelStone Han',         desc: '25MB, 通用甲骨/金文/简帛 fallback' },
  ],
  xiaozhuan: [
    { id: 'QuanZiKuShuoWen',   label: '全字庫說文解字 (默认)', desc: '10MB, 专用小篆' },
    { id: 'HanDianJinWen',     label: 'BabelStone Han',         desc: '25MB, 通用 fallback' },
  ],
  lishu: [
    { id: 'WangHanzongLishu',  label: '王漢宗中隸書繁 (默认)', desc: '8.1MB, 专用隶书' },
    { id: 'ZCOOLXiaoWei',      label: '站酷小薇',              desc: '6.1MB, 现代隶书感' },
  ],
  kaishu: [
    { id: 'ZCOOLXiaoWei',      label: '站酷小薇 (默认)',       desc: '6.1MB, react-pdf 兼容' },
    { id: 'KaiTi',             label: '系统楷体',              desc: 'local(KaiTi) / STKaiti / BiauKai' },
    { id: 'Iansui',            label: '汉仪润圆',              desc: '1.2MB, 圆润楷书' },
    { id: 'MaShanZheng',       label: '马善政',                desc: '3.2MB, 楷书带毛笔感' },
  ],
};

const DEFAULT_ERA_FONTS: Record<Era, string> = {
  jiaguwen: 'Oracular',
  jinwen: 'WangHanzongWeibei',
  xiaozhuan: 'QuanZiKuShuoWen',
  lishu: 'WangHanzongLishu',
  kaishu: 'ZCOOLXiaoWei',
};

const ERA_LABEL: Record<Era, string> = {
  jiaguwen: '甲骨文',
  jinwen: '金文',
  xiaozhuan: '小篆',
  lishu: '隶书',
  kaishu: '楷书',
};

interface Props {
  initial: Record<Era, string>;
}

export function FontConfigForm({ initial }: Props) {
  const [fonts, setFonts] = useState<Record<Era, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function changedEras(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const era of ERAS) {
      if (fonts[era] !== initial[era]) out[era] = fonts[era];
    }
    return out;
  }

  async function onSave() {
    const changes = changedEras();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/font-config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `保存失败 (${res.status})`);
        return;
      }
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {ERAS.map((era) => (
        <div key={era}>
          <label className="block text-sm font-medium text-ink mb-1">
            {ERA_LABEL[era]}
          </label>
          <select
            value={fonts[era]}
            onChange={(e) => setFonts((prev) => ({ ...prev, [era]: e.target.value }))}
            className="w-full max-w-md border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
            data-testid={`era-${era}-select`}
            aria-label={ERA_LABEL[era]}
          >
            {ERA_FONTS[era].map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label} — {opt.desc}
              </option>
            ))}
          </select>
          {fonts[era] !== DEFAULT_ERA_FONTS[era] && (
            <p className="mt-1 text-xs text-seal">非默认</p>
          )}
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2 border-t border-paper-warm">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded bg-seal px-4 py-1.5 text-white text-sm hover:bg-seal/80 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {savedAt && (
          <span className="text-xs text-ink-faint">已于 {savedAt.toLocaleTimeString('zh-CN')} 保存</span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}