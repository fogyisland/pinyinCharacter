import { Boxes, Lock, Radio } from 'lucide-react';
import { CopyButton } from './CopyButton';
import { formatMcpClientConfig } from '@/lib/mcp-client-config';
import { MCP_CAPABILITIES } from '@/mcp/capabilities';

/**
 * The head of the admin's MCP page.
 *
 * The page used to open with five counters and a table, which made it
 * look like any other admin list — an operator could not tell from the
 * first screen that this site *is* an MCP server. This panel says so:
 * the endpoint is the first thing on the page, in full, with a button
 * that puts it on the clipboard; the number of tools and the way the
 * service authenticates are next to it; and the client configuration is
 * one click away.
 *
 * The raw token is deliberately absent. It belongs to the user who
 * requested it, it is shown exactly once on /profile, and this panel
 * only ever carries the placeholder.
 */
export function McpHero({ endpoint }: { endpoint: string }) {
  const configText = formatMcpClientConfig(endpoint, null);
  const toolCount = MCP_CAPABILITIES.length;

  return (
    <section className="mb-5 rounded-lg border border-seal/30 bg-paper-soft p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-seal" aria-hidden="true" />
              <h2 className="font-kai text-lg text-ink leading-tight">MCP 服务</h2>
            </span>
            <span className="text-[11px] text-ink-faint">挂在本站点 · 无需另开进程</span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <code className="font-mono text-sm text-seal break-all">{endpoint}</code>
            <CopyButton text={endpoint} label="复制地址" copiedLabel="地址已复制" />
          </div>

          <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-ink-soft">
            <li className="inline-flex items-center gap-1.5">
              <Boxes className="h-3.5 w-3.5 text-seal" aria-hidden="true" />
              {toolCount} 个工具
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-seal" aria-hidden="true" />
              Bearer Token 鉴权
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5 text-seal" aria-hidden="true" />
              全部只读，不改动站内数据
            </li>
          </ul>
        </div>

        <div className="shrink-0 flex flex-col items-start gap-2">
          <CopyButton
            text={configText}
            label="复制客户端配置"
            copiedLabel="配置已复制"
            variant="primary"
            size="md"
          />
          <p className="text-[11px] text-ink-faint">Claude Desktop / Claude Code 通用</p>
          <details className="text-[11px] text-ink-faint">
            <summary className="cursor-pointer select-none hover:text-ink">查看配置内容</summary>
            <pre className="mt-1.5 max-w-sm whitespace-pre-wrap break-all rounded border border-ink/10 bg-paper p-2 font-mono text-[11px] text-ink">
              {configText}
            </pre>
          </details>
        </div>
      </div>
    </section>
  );
}
