'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
// The type import is erased at compile time. A value import would drag
// `node:crypto` and `mysql2` (which lib/mcp-token.ts pulls in) into the
// client bundle.
import type { McpTokenStatus } from '@/lib/mcp-token';

/** The HTTP endpoint that issues, rotates and revokes the token. */
const TOKEN_ENDPOINT = '/api/mcp/token';

/**
 * The literal the client config template carries when no raw token exists.
 *
 * The raw token is shown exactly once, in its own block. The config block
 * always shows this placeholder, so the user pastes the token they just
 * received into it themselves.
 */
const TOKEN_PLACEHOLDER = 'mcp_<the raw token>';

interface McpTokenActionsProps {
  initialStatus: McpTokenStatus;
  endpoint: string;
}

/** The part of the API envelope this card reads. */
interface TokenApiEnvelope {
  data?: {
    token?: string;
    createdAt?: string;
    revokedAt?: string | null;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

/** The client configuration an AI client needs to reach this site. */
interface McpServerConfig {
  mcpServers: {
    'ziyun-chinese': {
      type: 'http';
      url: string;
      headers: { Authorization: string };
    };
  };
}

/** What the card copies: the raw token, or the client config. */
type CopyTarget = 'token' | 'config';

/**
 * The client configuration.
 *
 * It is built here, from the endpoint, and never taken from the API
 * answer: the POST answer of /api/mcp/token carries the *real* token in
 * its `config` field, and pasting that into the card would break the
 * "shown only once" promise on the spot.
 */
function buildConfig(endpoint: string): McpServerConfig {
  return {
    mcpServers: {
      'ziyun-chinese': {
        type: 'http',
        url: endpoint,
        headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` },
      },
    },
  };
}

/**
 * The JSON body of an API answer, or an empty envelope when the body is
 * not JSON at all.
 */
async function readEnvelope(response: Response): Promise<TokenApiEnvelope> {
  try {
    const body: unknown = await response.json();
    return (body ?? {}) as TokenApiEnvelope;
  } catch (err) {
    console.error('[mcp-token] the API answer was not JSON', err);
    return {};
  }
}

/**
 * The Chinese message for a failed request.
 *
 * The branch is on the HTTP status, not on the error code: this endpoint
 * answers `unauthorized` / `forbidden`, while the other cookie-authenticated
 * endpoints of the site answer `unauthenticated` / `account_disabled`.
 */
async function describeFailure(response: Response): Promise<string> {
  if (response.status === 401) return '登录已失效，请重新登录';
  if (response.status === 403) return '账户已停用';
  const body = await readEnvelope(response);
  return body.error?.message || '操作失败，请稍后再试';
}

/** The raw token, in the one block that ever shows it. */
function RawTokenBlock({ token, onCopy }: { token: string; onCopy: (text: string) => void }) {
  return (
    <div className="border border-ink/10 bg-paper-soft p-3">
      <p className="text-xs text-ink-soft">只显示一次，关闭后无法再次查看</p>
      <div className="mt-2 flex items-start gap-3">
        <code data-testid="mcp-token" className="font-mono text-xs text-ink break-all">
          {token}
        </code>
        <button
          type="button"
          className="btn-ghost text-xs shrink-0"
          onClick={() => onCopy(token)}
        >
          复制
        </button>
      </div>
    </div>
  );
}

/** The client configuration, with the token left as a literal placeholder. */
function ClientConfigBlock({
  configText,
  onCopy,
}: {
  configText: string;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="border border-ink/10 bg-paper-soft p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-soft">客户端配置（把上面那枚 Token 填进 Authorization）</p>
        <button
          type="button"
          className="btn-ghost text-xs shrink-0"
          onClick={() => onCopy(configText)}
        >
          复制配置
        </button>
      </div>
      <pre
        data-testid="mcp-config"
        className="mt-2 font-mono text-xs text-ink whitespace-pre-wrap break-all"
      >
        {configText}
      </pre>
    </div>
  );
}

/**
 * The MCP token actions on /profile.
 *
 * The card owns one state — the token status — plus the raw token, which
 * lives here and nowhere else: not in the props, not in localStorage, not
 * in the config block. A reload therefore loses it, which is exactly what
 * "shown only once" means.
 */
export function McpTokenActions({ initialStatus, endpoint }: McpTokenActionsProps) {
  const [status, setStatus] = useState<McpTokenStatus>(initialStatus);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const configText = useMemo(() => JSON.stringify(buildConfig(endpoint), null, 2), [endpoint]);

  const issue = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(TOKEN_ENDPOINT, { method: 'POST' });
      if (!response.ok) {
        setError(await describeFailure(response));
        return;
      }
      const body = await readEnvelope(response);
      const token = body.data?.token;
      if (!token) {
        setError('服务返回的数据不完整，请稍后再试');
        return;
      }
      setRawToken(token);
      setStatus({
        state: 'active',
        createdAt: body.data?.createdAt ?? null,
        lastUsedAt: null,
        revokedAt: null,
      });
    } catch (err) {
      console.error('[mcp-token] the issue request failed', err);
      setError('网络错误，请稍后再试');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const revoke = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(TOKEN_ENDPOINT, { method: 'DELETE' });
      if (!response.ok) {
        setError(await describeFailure(response));
        return;
      }
      const body = await readEnvelope(response);
      setStatus((previous): McpTokenStatus => ({
        ...previous,
        state: 'revoked',
        revokedAt: body.data?.revokedAt ?? null,
      }));
      setRawToken(null);
    } catch (err) {
      console.error('[mcp-token] the revoke request failed', err);
      setError('网络错误，请稍后再试');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const copy = useCallback(async (text: string, target: CopyTarget) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(target === 'token' ? 'Token 已复制到剪贴板' : '配置已复制到剪贴板');
    } catch (err) {
      console.error('[mcp-token] could not copy to the clipboard', err);
      setNotice('复制失败，请手动选中后复制');
    }
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-kai text-lg text-ink">MCP Token</h2>
        <p className="text-sm text-ink-soft mt-1">
          MCP 服务挂在本站点的 /mcp，用下面的配置接入你的 AI 客户端。
        </p>
      </div>

      {status.state === 'active' ? (
        <div className="space-y-3">
          <p className="text-sm text-ink">Token 有效中。重新生成会立即作废旧 Token，旧 Token 随即失效。</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-seal text-sm" onClick={issue} disabled={busy}>
              重新生成
            </button>
            <button type="button" className="btn-ghost text-sm" onClick={revoke} disabled={busy}>
              吊销
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink">
            {status.state === 'revoked'
              ? 'Token 已吊销。重新申请会签发一枚新 Token。'
              : '你还没有 MCP Token。申请后即可把本站点的 MCP 服务接入你的 AI 客户端。'}
          </p>
          <button type="button" className="btn-seal text-sm" onClick={issue} disabled={busy}>
            申请 MCP Token
          </button>
        </div>
      )}

      {rawToken ? (
        <RawTokenBlock token={rawToken} onCopy={(text) => void copy(text, 'token')} />
      ) : null}

      {status.state === 'active' ? (
        <ClientConfigBlock configText={configText} onCopy={(text) => void copy(text, 'config')} />
      ) : null}

      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {notice ? <p className="text-xs text-ink-soft">{notice}</p> : null}
    </div>
  );
}
