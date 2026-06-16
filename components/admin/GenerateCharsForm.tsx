'use client';

import { useRef, useState } from 'react';

type Tab = 'dict' | 'etymology' | 'batch' | 'rare';

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

const ALL_BATCH_FIELDS = [
  { key: 'meaning_zh', label: '释义(中文)' },
  { key: 'meaning_en', label: '释义(英文)' },
  { key: 'pinyin_alt', label: '多音' },
  { key: 'variants', label: '异体' },
  { key: 'etymology_story', label: '字源故事' },
  { key: 'rare_meaning', label: '罕见字释义(L3)' },
  { key: 'rare_story', label: '罕见字故事(L3)' },
] as const;

const LEVELS = [
  { value: 1, label: 'L1', desc: '常用字 (3500 字)' },
  { value: 2, label: 'L2', desc: '次常用字 (2996 字)' },
  { value: 3, label: 'L3 / 罕见字', desc: '罕见字 (1412 字)' },
] as const;

export function GenerateCharsForm() {
  const [tab, setTab] = useState<Tab>('dict');

  return (
    <div>
      <div className="flex border-b border-paper-warm mb-4">
        <TabBtn active={tab === 'dict'} onClick={() => setTab('dict')}>字典字段</TabBtn>
        <TabBtn active={tab === 'etymology'} onClick={() => setTab('etymology')}>字源</TabBtn>
        <TabBtn active={tab === 'batch'} onClick={() => setTab('batch')}>按级别批量</TabBtn>
        <TabBtn active={tab === 'rare'} onClick={() => setTab('rare')}>罕见字</TabBtn>
      </div>

      {tab === 'dict' && <DictTab />}
      {tab === 'etymology' && <EtymologyTab />}
      {tab === 'batch' && <BatchTab />}
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

// --- 按级别批量 tab ---

type BatchStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

interface BatchProgress {
  totalChars: number;
  processed: number;
  nextOffset: number;
  elapsedMs: number;
  perField: Record<string, FieldResult>;
}

const EMPTY_PROGRESS: BatchProgress = {
  totalChars: 0,
  processed: 0,
  nextOffset: 0,
  elapsedMs: 0,
  perField: {},
};

function useBatchRunner() {
  const [status, setStatus] = useState<BatchStatus>('idle');
  const [progress, setProgress] = useState<BatchProgress>(EMPTY_PROGRESS);
  const [lastError, setLastError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const pauseRef = useRef(false);
  const bodyRef = useRef<{ level: number; fields: Record<string, boolean>; concurrency: number } | null>(null);

  async function runOnce() {
    const body = bodyRef.current;
    if (!body) return;
    setLastError(null);
    try {
      const res = await fetch('/api/admin/chars/generate-by-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: body.level,
          fields: body.fields,
          offset: offsetRef.current,
          limit: 30,
          concurrency: body.concurrency,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        setLastError(j.error?.message ?? '请求失败');
        setStatus('error');
        return;
      }
      const d = j.data;
      offsetRef.current = d.nextOffset;
      setProgress((prev) => ({
        totalChars: d.totalChars,
        processed: prev.processed + d.processed,
        nextOffset: d.nextOffset,
        elapsedMs: prev.elapsedMs + d.elapsedMs,
        perField: mergePerField(prev.perField, d.perField),
      }));
      if (d.done) {
        setStatus('done');
      } else if (pauseRef.current) {
        setStatus('paused');
      } else {
        setTimeout(() => { if (!pauseRef.current) runOnce(); }, 800);
      }
    } catch (err) {
      setLastError((err as Error).message);
      setStatus('error');
    }
  }

  function start(level: number, fields: Record<string, boolean>, concurrency: number) {
    if (!Object.values(fields).some(Boolean)) {
      setLastError('请至少勾选 1 个字段');
      setStatus('error');
      return;
    }
    bodyRef.current = { level, fields, concurrency };
    offsetRef.current = 0;
    pauseRef.current = false;
    setProgress(EMPTY_PROGRESS);
    setLastError(null);
    setStatus('running');
    runOnce();
  }

  function pause() {
    pauseRef.current = true;
    setStatus('paused');
  }

  function resume() {
    pauseRef.current = false;
    setStatus('running');
    runOnce();
  }

  function reset() {
    pauseRef.current = true;
    bodyRef.current = null;
    offsetRef.current = 0;
    setProgress(EMPTY_PROGRESS);
    setLastError(null);
    setStatus('idle');
  }

  return { status, progress, lastError, start, pause, resume, reset };
}

function mergePerField(
  a: Record<string, FieldResult>,
  b: Record<string, FieldResult>,
): Record<string, FieldResult> {
  const out: Record<string, FieldResult> = { ...a };
  for (const k of Object.keys(b)) {
    const prev = a[k] ?? { generated: 0, skipped: 0, errors: [] };
    out[k] = {
      generated: prev.generated + b[k].generated,
      skipped: prev.skipped + b[k].skipped,
      errors: [...prev.errors, ...b[k].errors],
    };
  }
  return out;
}

function BatchTab() {
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [fields, setFields] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const f of ALL_BATCH_FIELDS) init[f.key] = true;
    return init;
  });
  const [concurrency, setConcurrency] = useState(4);
  const runner = useBatchRunner();

  const fieldLabels: Record<string, string> = Object.fromEntries(ALL_BATCH_FIELDS.map((f) => [f.key, f.label]));
  const pct = runner.progress.totalChars > 0
    ? Math.round((runner.progress.processed / runner.progress.totalChars) * 100)
    : 0;
  const etaMs = runner.progress.processed > 0 && !runner.status.includes('done') && runner.status !== 'error'
    ? (runner.progress.elapsedMs / runner.progress.processed) * (runner.progress.totalChars - runner.progress.processed)
    : 0;
  const fmtTime = (ms: number) => {
    if (!ms) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const ss = s % 60;
    if (m < 60) return `${m}m${ss.toString().padStart(2, '0')}s`;
    const h = Math.floor(m / 60);
    return `${h}h${(m % 60).toString().padStart(2, '0')}m`;
  };

  return (
    <div className="card-paper rounded-lg p-4 space-y-4">
      <p className="text-sm text-ink-soft">
        按级别遍历 <code>chars</code> 表,逐 30 字一批自动循环。已有值的字段会跳过(避免覆盖)。后台已配置的 AI 端点会处理 L1/L2/L3 的全部内容生成。
      </p>

      <div>
        <div className="text-sm font-semibold mb-2">级别</div>
        <div className="flex flex-wrap gap-3">
          {LEVELS.map((l) => (
            <label key={l.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="batch-level"
                value={l.value}
                checked={level === l.value}
                onChange={() => setLevel(l.value as 1 | 2 | 3)}
                disabled={runner.status === 'running'}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{l.label}</span>
                <span className="text-xs text-ink-soft ml-1">{l.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold mb-2">字段(全默认勾选)</div>
        <FieldCheckboxes options={ALL_BATCH_FIELDS} value={fields} onChange={setFields} />
      </div>

      <div>
        <label className="text-sm font-semibold">
          并发数 (LLM 同时调用数):
          <select
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            disabled={runner.status === 'running'}
            className="ml-2 border border-ink/30 rounded px-2 py-1 bg-paper"
          >
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <span className="text-xs text-ink-soft ml-2">并发越高越快,但易触发限速</span>
      </div>

      <div className="flex gap-2">
        {runner.status === 'idle' || runner.status === 'done' || runner.status === 'error' ? (
          <button type="button"
            onClick={() => runner.start(level, fields, concurrency)}
            disabled={!Object.values(fields).some(Boolean)}
            className="text-sm px-4 py-2 rounded bg-ink text-paper hover:bg-ink/80 disabled:opacity-50">
            ▶ 开始生成
          </button>
        ) : runner.status === 'running' ? (
          <button type="button" onClick={runner.pause}
            className="text-sm px-4 py-2 rounded bg-paper-warm border border-ink/30 hover:bg-ink/10">
            ⏸ 暂停
          </button>
        ) : (
          <button type="button" onClick={runner.resume}
            className="text-sm px-4 py-2 rounded bg-ink text-paper hover:bg-ink/80">
            ▶ 继续
          </button>
        )}
        {runner.status !== 'idle' && (
          <button type="button" onClick={runner.reset}
            className="text-sm px-4 py-2 rounded border border-ink/30 hover:bg-ink/10">
            重置
          </button>
        )}
      </div>

      {runner.lastError && (
        <div className="p-3 bg-paper-warm rounded text-sm text-seal">✗ {runner.lastError}</div>
      )}

      {(runner.progress.totalChars > 0 || runner.status === 'running') && (
        <BatchProgressView progress={runner.progress} status={runner.status} pct={pct} etaMs={etaMs} fmtTime={fmtTime} fieldLabels={fieldLabels} />
      )}
    </div>
  );
}

function BatchProgressView({ progress, status, pct, etaMs, fmtTime, fieldLabels }: {
  progress: BatchProgress;
  status: BatchStatus;
  pct: number;
  etaMs: number;
  fmtTime: (ms: number) => string;
  fieldLabels: Record<string, string>;
}) {
  return (
    <div className="mt-2 space-y-3">
      <div className="flex justify-between text-sm">
        <span>{progress.processed} / {progress.totalChars} ({pct}%)</span>
        <span className="text-ink-soft">
          {status === 'running' && `运行中… 剩余约 ${fmtTime(etaMs)}`}
          {status === 'paused' && '已暂停'}
          {status === 'done' && '✓ 全部完成'}
          {status === 'error' && '已停止(出错)'}
        </span>
      </div>
      <div className="w-full h-2 bg-paper-warm rounded overflow-hidden">
        <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {ALL_BATCH_FIELDS.map((f) => {
          const r = progress.perField[f.key] ?? { generated: 0, skipped: 0, errors: [] };
          return (
            <div key={f.key} className="flex justify-between border-b border-paper-warm py-1">
              <span>{f.label}</span>
              <span className="space-x-2">
                <span>✓ {r.generated}</span>
                {r.skipped > 0 && <span className="text-ink-soft">↷ {r.skipped}</span>}
                {r.errors.length > 0 && <span className="text-seal">✗ {r.errors.length}</span>}
              </span>
            </div>
          );
        })}
      </div>
      {(() => {
        const allErrors = Object.values(progress.perField).flatMap((r) => r.errors);
        if (allErrors.length === 0) return null;
        const show = allErrors.slice(0, 10);
        return (
          <div className="text-xs text-seal">
            <div>最近错误(共 {allErrors.length}):</div>
            <ul className="mt-1 ml-4 space-y-0.5">
              {show.map((e, i) => (
                <li key={i}>{e.char}: {e.message}</li>
              ))}
            </ul>
          </div>
        );
      })()}
    </div>
  );
}