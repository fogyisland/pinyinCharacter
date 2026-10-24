'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { updateAiConfigRequest } from '@/lib/api-admin';
import { FormField } from '@/components/admin/FormField';
import { AdminButton } from '@/components/admin/AdminButton';

/**
 * The /admin/ai configuration form.
 *
 * The values are read on the server and handed over as props, so opening the
 * tab needs no extra request. Saving goes through the existing admin API.
 */
export function AiConfigForm({
  initialConfig,
  initialHasApiKey,
}: {
  initialConfig: Record<string, string>;
  initialHasApiKey: boolean;
}) {
  const [config, setConfig] = useState<Record<string, string>>(initialConfig);
  const [hasApiKey, setHasApiKey] = useState(initialHasApiKey);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function set(key: string, value: string) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    // Skip the empty fields so a blank secret does not wipe the stored one
    // (ai.api_key is masked to '' in the response, it would otherwise be
    // overwritten on every save).
    const body: Record<string, string> = {};
    for (const [key, value] of Object.entries(config)) {
      if (value !== '') body[key] = value;
    }
    if (Object.keys(body).length === 0) {
      setMsg('未修改任何字段');
      setBusy(false);
      return;
    }
    try {
      const result = await updateAiConfigRequest(body);
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      setConfig(result.data.config);
      setHasApiKey(result.data.hasApiKey);
      setMsg('配置已保存');
    } catch (e) {
      setErr((e as Error).message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card-paper rounded-lg p-4 space-y-3 max-w-xl">
      {err && (
        <p className="text-sm text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">
          {err}
        </p>
      )}
      {msg && (
        <p className="text-sm text-success inline-flex items-center gap-1">
          <Check className="h-3.5 w-3.5" />
          {msg}
        </p>
      )}

      <div className="space-y-1">
        <h2 className="font-kai text-base text-ink">AI 连接配置</h2>
        <p className="text-xs text-ink-soft">
          写入 <code>app_config</code> 表,优先级高于环境变量 <code>LLM_API_KEY</code> /{' '}
          <code>LLM_BASE_URL</code> / <code>LLM_MODEL</code>。
        </p>
      </div>
      <ConfigField
        id="ai-base-url"
        label="端点 URL (Base URL)"
        hint="OpenAI 兼容 API 根地址"
        placeholder="https://api.openai.com/v1"
        value={config['ai.base_url'] ?? ''}
        onChange={(v) => set('ai.base_url', v)}
      />
      <ConfigField
        id="ai-api-key"
        label="连接 KEY (API Key)"
        hint={hasApiKey ? '已配置,留空不改' : '尚未配置'}
        type="password"
        value={config['ai.api_key'] ?? ''}
        onChange={(v) => set('ai.api_key', v)}
      />
      <ConfigField
        id="ai-model"
        label="模型"
        hint="MiniMax-M3 / MiniMax-M2.7 / MiniMax-M2.7-highspeed / MiniMax-M2.5 / MiniMax-M2.5-highspeed / MiniMax-M2.1 / MiniMax-M2.1-highspeed / MiniMax-M"
        placeholder="MiniMax-M3"
        value={config['ai.model'] ?? ''}
        onChange={(v) => set('ai.model', v)}
      />

      <div className="pt-2 space-y-1">
        <h2 className="font-kai text-base text-ink">AI 运行参数</h2>
        <p className="text-xs text-ink-soft">LLM 调用层面的限速/超时/采样。</p>
      </div>
      <ConfigField
        id="ai-rate-limit"
        label="限速 (次/用户/日)"
        placeholder="20"
        value={config['ai.rate_limit_per_user_per_day'] ?? ''}
        onChange={(v) => set('ai.rate_limit_per_user_per_day', v)}
      />
      <ConfigField
        id="ai-timeout"
        label="超时 (毫秒)"
        placeholder="30000"
        value={config['ai.timeout_ms'] ?? ''}
        onChange={(v) => set('ai.timeout_ms', v)}
      />
      <ConfigField
        id="ai-temperature"
        label="温度"
        placeholder="0.3"
        value={config['ai.temperature'] ?? ''}
        onChange={(v) => set('ai.temperature', v)}
      />
      <ConfigSelectField
        id="ai-thinking"
        label="思考模式 (thinking)"
        hint="MiniMax-M3 等推理模型:disabled 直接作答;adaptive 先推理再作答(可能更准但会占用 token 预算)"
        value={config['ai.thinking'] ?? 'disabled'}
        options={[
          { value: 'disabled', label: 'disabled' },
          { value: 'adaptive', label: 'adaptive' },
        ]}
        onChange={(v) => set('ai.thinking', v)}
      />
      <ConfigField
        id="ai-max-tokens"
        label="最大输出 token (max_completion_tokens)"
        hint="M3 推荐 131072,M2.x 推荐 65536;上限 524288"
        placeholder="4096"
        value={config['ai.max_completion_tokens'] ?? ''}
        onChange={(v) => set('ai.max_completion_tokens', v)}
      />

      <AdminButton type="submit" variant="primary" disabled={busy} className="pt-1">
        {busy ? '保存中…' : '保存'}
      </AdminButton>
    </form>
  );
}

function ConfigField({
  id,
  label,
  hint,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'password';
  placeholder?: string;
}) {
  return (
    <FormField label={label} htmlFor={id} hint={hint}>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="adm-input"
      />
    </FormField>
  );
}

function ConfigSelectField({
  id,
  label,
  hint,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <FormField label={label} htmlFor={id} hint={hint}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="adm-input"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}
