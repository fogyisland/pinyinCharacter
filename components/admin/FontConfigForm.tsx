'use client';

import { useState } from 'react';
import { ERAS, type Era } from '@/lib/etymology-types';
import { ERA_FONTS, DEFAULT_ERA_FONTS } from '@/lib/era-fonts-data';
import { formatTime } from '@/lib/format';
import { Panel } from '@/components/admin/Panel';
import { FormField } from '@/components/admin/FormField';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { AdminButton } from '@/components/admin/AdminButton';

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
    <Panel title="时代字体" description="每个时代一款字体,保存后立即生效。">
      <div className="space-y-4 max-w-xl">
        {ERAS.map((era) => (
          <div key={era}>
            <FormField label={ERA_LABEL[era]} htmlFor={`era-${era}-select`}>
              <select
                id={`era-${era}-select`}
                value={fonts[era]}
                onChange={(e) => setFonts((prev) => ({ ...prev, [era]: e.target.value }))}
                className="adm-input"
                data-testid={`era-${era}-select`}
                aria-label={ERA_LABEL[era]}
              >
                {ERA_FONTS[era].map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label} — {opt.desc}
                  </option>
                ))}
              </select>
            </FormField>
            {fonts[era] !== DEFAULT_ERA_FONTS[era] && (
              <p className="mt-1">
                <StatusBadge tone="warning">非默认</StatusBadge>
              </p>
            )}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-ink/10">
          <AdminButton type="button" variant="primary" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </AdminButton>
          {savedAt && <span className="text-xs text-ink-faint">已于 {formatTime(savedAt)} 保存</span>}
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      </div>
    </Panel>
  );
}
