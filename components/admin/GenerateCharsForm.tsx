'use client';

import { useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { Panel } from '@/components/admin/Panel';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';
import { BatchProgressView, GenerateResult } from './generate/GenerateResult';
import { useBatchRunner, useSubmit } from './generate/use-generate';
import {
  ALL_BATCH_FIELDS,
  DICT_FIELDS,
  LEVELS,
  RARE_FIELDS,
  TABS,
  countHanChars,
  type Tab,
} from './generate/generate-types';

/**
 * The character generation console of /admin/chars/generate.
 *
 * Four ways to fill the character tables: one hand-picked field, the
 * etymology story, the rare-character fields, and a level-wide batch run.
 * The panels are the shared admin ones, so the page reads like the rest of
 * the backend instead of a form that was built before the design system
 * existed.
 */
export function GenerateCharsForm() {
  const [tab, setTab] = useState<Tab>('dict');

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="生成方式"
        className="flex flex-wrap gap-1 border-b border-ink/10"
      >
        {TABS.map((t) => (
          <TabBtn key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </TabBtn>
        ))}
      </div>

      {tab === 'dict' && <DictTab />}
      {tab === 'etymology' && <EtymologyTab />}
      {tab === 'batch' && <BatchTab />}
      {tab === 'rare' && <RareTab />}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? 'border-seal text-ink font-semibold'
          : 'border-transparent text-ink-soft hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function CharInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const count = countHanChars(value);
  return (
    <FormField
      label="汉字"
      htmlFor={id}
      hint={`已输入 ${count} 个字(逐字生成,每次最多 100 字)`}
    >
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        maxLength={200}
        placeholder="输入汉字,如 一丁七万丈三..."
        className="adm-input"
      />
    </FormField>
  );
}

function FieldCheckboxes<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ key: T; label: string }>;
  value: Record<T, boolean>;
  onChange: (v: Record<T, boolean>) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {options.map((o) => (
        <label key={o.key} className="inline-flex items-center gap-1 text-ink cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4"
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

  const fieldLabels: Record<string, string> = Object.fromEntries(
    DICT_FIELDS.map((f) => [f.key, f.label]),
  );

  return (
    <Panel
      title="逐字生成"
      description={
        <>
          为 <code>chars</code> 表填字段。已有值的字段会被跳过(避免覆盖人工填写)。需要先清空才能重新生成。
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(chars, fields);
        }}
        className="space-y-4"
      >
        <div>
          <div className="text-sm font-medium text-ink mb-2">要生成的字段</div>
          <FieldCheckboxes options={DICT_FIELDS} value={fields} onChange={setFields} />
        </div>
        <CharInput id="dict-chars" value={chars} onChange={setChars} />
        <AdminButton type="submit" variant="primary" disabled={loading}>
          {loading ? '生成中…' : '生成'}
        </AdminButton>
        <GenerateResult result={result} error={error} fieldLabels={fieldLabels} />
      </form>
    </Panel>
  );
}

function EtymologyTab() {
  const [chars, setChars] = useState('');
  const { loading, result, error, submit } = useSubmit();

  return (
    <Panel
      title="字源故事"
      description={
        <>
          为 <code>char_etymology</code> 表填字源演变故事。已有 story 的字会被跳过。
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(chars, { etymology_story: true });
        }}
        className="space-y-4"
      >
        <CharInput id="etymology-chars" value={chars} onChange={setChars} />
        <AdminButton type="submit" variant="primary" disabled={loading}>
          {loading ? '生成中…' : '生成字源'}
        </AdminButton>
        <GenerateResult result={result} error={error} fieldLabels={{ etymology_story: '字源' }} />
      </form>
    </Panel>
  );
}

function RareTab() {
  const [chars, setChars] = useState('');
  const [fields, setFields] = useState<Record<string, boolean>>({
    rare_meaning: true,
    rare_story: true,
  });
  const { loading, result, error, submit } = useSubmit();

  const fieldLabels: Record<string, string> = Object.fromEntries(
    RARE_FIELDS.map((f) => [f.key, f.label]),
  );

  return (
    <Panel
      title="罕见字"
      description={
        <>
          为 <code>rare_chars</code> 表填释义和/或故事。已有值的字段会被跳过。字必须在{' '}
          <code>rare_chars</code> 表中存在。
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(chars, fields);
        }}
        className="space-y-4"
      >
        <div>
          <div className="text-sm font-medium text-ink mb-2">要生成的字段</div>
          <FieldCheckboxes options={RARE_FIELDS} value={fields} onChange={setFields} />
        </div>
        <CharInput id="rare-chars" value={chars} onChange={setChars} />
        <AdminButton type="submit" variant="primary" disabled={loading}>
          {loading ? '生成中…' : '生成'}
        </AdminButton>
        <GenerateResult result={result} error={error} fieldLabels={fieldLabels} />
      </form>
    </Panel>
  );
}

// --- 按级别批量 tab ---

function BatchTab() {
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [fields, setFields] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const f of ALL_BATCH_FIELDS) init[f.key] = true;
    return init;
  });
  const [concurrency, setConcurrency] = useState(4);
  const runner = useBatchRunner();

  const visibleFields =
    level === 3
      ? ALL_BATCH_FIELDS
      : ALL_BATCH_FIELDS.filter((f) => f.key !== 'rare_meaning' && f.key !== 'rare_story');
  const pct =
    runner.progress.totalChars > 0
      ? Math.round((runner.progress.processed / runner.progress.totalChars) * 100)
      : 0;
  const etaMs =
    runner.progress.processed > 0 && runner.status !== 'done' && runner.status !== 'error'
      ? (runner.progress.elapsedMs / runner.progress.processed) *
        (runner.progress.totalChars - runner.progress.processed)
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

  const isRunning = runner.status === 'running';
  const canStart = !isRunning && visibleFields.some((f) => fields[f.key]);
  const hasProgress = runner.progress.totalChars > 0 || isRunning;

  return (
    <div className="space-y-4">
      <Panel
        title="按级别批量"
        description={
          <>
            按级别遍历 <code>chars</code> 表,逐 30 字一批自动循环。已有值的字段会跳过(避免覆盖)。后台已配置的
            AI 端点会处理 L1/L2/L3 的全部内容生成。
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-ink mb-2">级别</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {LEVELS.map((l) => (
                <label
                  key={l.value}
                  className={`flex items-start gap-2 rounded border p-2.5 cursor-pointer transition-colors ${
                    level === l.value
                      ? 'border-seal/50 bg-seal/5'
                      : 'border-ink/15 hover:border-ink/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="batch-level"
                    value={l.value}
                    checked={level === l.value}
                    onChange={() => setLevel(l.value)}
                    disabled={isRunning}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{l.label}</span>
                    <span className="block text-xs text-ink-soft">{l.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-ink mb-2">
              字段(全默认勾选)
              {level !== 3 && (
                <span className="text-xs text-ink-faint font-normal ml-2">
                  L3 才会有"罕见字释义/故事"
                </span>
              )}
            </div>
            <FieldCheckboxes options={visibleFields} value={fields} onChange={setFields} />
          </div>

          <FormField
            label="并发数 (LLM 同时调用数)"
            htmlFor="batch-concurrency"
            hint="并发越高越快,但易触发限速"
          >
            <select
              id="batch-concurrency"
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              disabled={isRunning}
              className="adm-input max-w-xs"
            >
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormField>

          {runner.lastError && (
            <div className="rounded border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
              ✗ {runner.lastError}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {runner.status === 'idle' ||
            runner.status === 'done' ||
            runner.status === 'error' ? (
              <AdminButton
                variant="primary"
                icon={<Play className="h-3.5 w-3.5" />}
                disabled={!canStart}
                onClick={() => {
                  const applicableFields: Record<string, boolean> = {};
                  for (const f of visibleFields) applicableFields[f.key] = !!fields[f.key];
                  runner.start(level, applicableFields, concurrency);
                }}
              >
                开始生成
              </AdminButton>
            ) : isRunning ? (
              <AdminButton
                variant="secondary"
                icon={<Pause className="h-3.5 w-3.5" />}
                onClick={runner.pause}
              >
                暂停
              </AdminButton>
            ) : (
              <AdminButton
                variant="primary"
                icon={<Play className="h-3.5 w-3.5" />}
                onClick={runner.resume}
              >
                继续
              </AdminButton>
            )}
            {runner.status !== 'idle' && (
              <AdminButton
                variant="ghost"
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={runner.reset}
              >
                重置
              </AdminButton>
            )}
          </div>
        </div>
      </Panel>

      {hasProgress && (
        <Panel title="执行进度" description="按字段统计的生成情况">
          <BatchProgressView
            progress={runner.progress}
            status={runner.status}
            pct={pct}
            etaMs={etaMs}
            fmtTime={fmtTime}
          />
        </Panel>
      )}
    </div>
  );
}
