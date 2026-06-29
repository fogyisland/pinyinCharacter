'use client';

import { useState } from 'react';
import { ERAS, type Era } from '@/lib/etymology-types';
import { ERA_FONTS, DEFAULT_ERA_FONTS } from '@/lib/era-fonts-data';

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