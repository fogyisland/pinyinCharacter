'use client';

import { useState } from 'react';

type Tab = 'dict' | 'etymology' | 'rare';

interface FieldResult {
  generated: number;
  skipped: number;
  errors: { char: string; message: string }[];
}

interface GenerateResponse {
  perField: Record<string, FieldResult>;
  totals: FieldResult;
}

const DICT_FIELDS = [
  { key: 'meaning_zh', label: '释义 (中文)' },
  { key: 'meaning_en', label: '释义 (英文)' },
  { key: 'pinyin_alt', label: '多音' },
  { key: 'variants', label: '异体' },
] as const;

const RARE_FIELDS = [
  { key: 'rare_meaning', label: '释义' },
  { key: 'rare_story', label: '故事' },
] as const;

export function GenerateCharsForm() {
  const [tab, setTab] = useState<Tab>('dict');

  return (
    <div>
      <div className="flex border-b border-paper-warm mb-4">
        <TabBtn active={tab === 'dict'} onClick={() => setTab('dict')}>字典字段</TabBtn>
        <TabBtn active={tab === 'etymology'} onClick={() => setTab('etymology')}>字源</TabBtn>
        <TabBtn active={tab === 'rare'} onClick={() => setTab('rare')}>罕见字</TabBtn>
      </div>

      {tab === 'dict' && <DictTab />}
      {tab === 'etymology' && <EtymologyTab />}
      {tab === 'rare' && <RareTab />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 -mb-px ${
        active ? 'border-ink text-ink font-semibold' : 'border-transparent text-ink-soft hover:text-ink'
      }`}>
      {children}
    </button>
  );
}

function CharInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const count = Array.from(value).filter((c) => /[一-鿿]/.test(c)).length;
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        maxLength={200}
        placeholder="输入汉字,如 一丁七万丈三..."
        className="w-full border border-ink/30 rounded p-2 text-base font-serif bg-paper"
      />
      <span className="text-xs text-ink-soft">已输入 {count} 个字(逐字生成,每次最多 100 字)</span>
    </div>
  );
}

function useSubmit() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(chars: string, fields: Record<string, boolean>) {
    setError(null); setResult(null);
    const validChars = Array.from(chars).filter((c) => /[一-鿿]/.test(c));
    if (validChars.length === 0) { setError('请输入至少 1 个汉字'); return; }
    if (!Object.values(fields).some(Boolean)) { setError('请至少勾选 1 个字段'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/chars/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chars: validChars, fields }),
      });
      const j = await res.json();
      if (!j.ok) { setError(j.error?.message ?? '生成失败'); return; }
      setResult(j.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return { loading, result, error, submit };
}

function ResultPanel({ result, error, fieldLabels }: {
  result: GenerateResponse | null;
  error: string | null;
  fieldLabels: Record<string, string>;
}) {
  if (error) return <div className="mt-4 p-3 bg-paper-warm rounded text-sm text-seal">✗ {error}</div>;
  if (!result) return null;
  const { totals } = result;
  return (
    <div className="mt-4 p-3 bg-paper-warm rounded text-sm space-y-2">
      <div>✓ 已生成 <span className="font-semibold">{totals.generated}</span> 个</div>
      {totals.skipped > 0 && <div>↷ 跳过 {totals.skipped} 个(字段已有值)</div>}
      {totals.errors.length > 0 && (
        <div className="text-seal">
          <div>✗ 失败 {totals.errors.length} 个:</div>
          <ul className="mt-1 ml-4 text-xs space-y-0.5">
            {totals.errors.map((e, i) => (
              <li key={i}>{e.char} ({fieldLabels[labelForError(e.char, totals)] ?? '未知'}): {e.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function labelForError(char: string, totals: FieldResult): string {
  // Find the field name for this char from the perField breakdown.
  // Caller passes totals; we just return the most common error message field.
  // Simpler: just show char + message without field label.
  return char;
}

function FieldCheckboxes<T extends string>({ options, value, onChange }: {
  options: ReadonlyArray<{ key: T; label: string }>;
  value: Record<T, boolean>;
  onChange: (v: Record<T, boolean>) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {options.map((o) => (
        <label key={o.key} className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!value[o.key]}
            onChange={(e) => onChange({ ...value, [o.key]: e.target.checked })}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function DictTab() {
  const [chars, setChars] = useState('');
  const [fields, setFields] = useState<Record<string, boolean>>({
    meaning_zh: true,
    meaning_en: false,
    pinyin_alt: false,
    variants: false,
  });
  const { loading, result, error, submit } = useSubmit();

  const fieldLabels: Record<string, string> = Object.fromEntries(DICT_FIELDS.map((f) => [f.key, f.label]));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(chars, fields); }}
      className="card-paper rounded-lg p-4 space-y-3"
    >
      <p className="text-sm text-ink-soft">
        为 <code>chars</code> 表填字段。已有值的字段会被跳过(避免覆盖人工填写)。需要先清空才能重新生成。
      </p>
      <FieldCheckboxes options={DICT_FIELDS} value={fields} onChange={setFields} />
      <CharInput value={chars} onChange={setChars} />
      <button type="submit" disabled={loading}
        className="text-sm px-4 py-2 rounded bg-ink text-paper hover:bg-ink/80 disabled:opacity-50">
        {loading ? '生成中…' : '生成'}
      </button>
      <ResultPanel result={result} error={error} fieldLabels={fieldLabels} />
    </form>
  );
}

function EtymologyTab() {
  const [chars, setChars] = useState('');
  const { loading, result, error, submit } = useSubmit();

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(chars, { etymology_story: true }); }}
      className="card-paper rounded-lg p-4 space-y-3"
    >
      <p className="text-sm text-ink-soft">
        为 <code>char_etymology</code> 表填字源演变故事。已有 story 的字会被跳过。
      </p>
      <CharInput value={chars} onChange={setChars} />
      <button type="submit" disabled={loading}
        className="text-sm px-4 py-2 rounded bg-ink text-paper hover:bg-ink/80 disabled:opacity-50">
        {loading ? '生成中…' : '生成字源'}
      </button>
      <ResultPanel result={result} error={error} fieldLabels={{ etymology_story: '字源' }} />
    </form>
  );
}

function RareTab() {
  const [chars, setChars] = useState('');
  const [fields, setFields] = useState<Record<string, boolean>>({
    rare_meaning: true,
    rare_story: true,
  });
  const { loading, result, error, submit } = useSubmit();

  const fieldLabels: Record<string, string> = Object.fromEntries(RARE_FIELDS.map((f) => [f.key, f.label]));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(chars, fields); }}
      className="card-paper rounded-lg p-4 space-y-3"
    >
      <p className="text-sm text-ink-soft">
        为 <code>rare_chars</code> 表填释义和/或故事。已有值的字段会被跳过。字必须在 rare_chars 表中存在。
      </p>
      <FieldCheckboxes options={RARE_FIELDS} value={fields} onChange={setFields} />
      <CharInput value={chars} onChange={setChars} />
      <button type="submit" disabled={loading}
        className="text-sm px-4 py-2 rounded bg-ink text-paper hover:bg-ink/80 disabled:opacity-50">
        {loading ? '生成中…' : '生成'}
      </button>
      <ResultPanel result={result} error={error} fieldLabels={fieldLabels} />
    </form>
  );
}