import {
  groupCapabilitiesByCategory,
  MCP_CAPABILITIES,
  type McpCapability,
} from '@/mcp/capabilities';

/**
 * The catalogue of the MCP tools, as the admin page shows it.
 *
 * The list is grouped by subject — 汉字 / 拼音 / 闯关 / 字帖 / 古诗 / 佛经 /
 * 典籍 / 语音 — so an operator can see at a glance what the endpoint can
 * answer, and where the gaps are.
 *
 * The page shows the subjects first, with their counts, and keeps the
 * twenty entries themselves behind a disclosure. When the catalogue was
 * the last thing on the page it was a wall of text nobody scrolled to;
 * now it sits above the token table, where the subject line is what the
 * reader actually needs, and the details are one click away.
 *
 * Every entry carries the tool's name (what an AI client calls it), its
 * registered title and one Chinese line saying what it answers.
 */
export function McpCapabilityList() {
  const groups = groupCapabilitiesByCategory(MCP_CAPABILITIES);
  const total = MCP_CAPABILITIES.length;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5" data-testid="mcp-capability-chips">
        {groups.map((group) => (
          <span
            key={group.key}
            className="inline-flex items-center gap-1 rounded border border-ink/15 bg-paper-soft px-2 py-0.5 text-xs text-ink-soft"
          >
            {group.label}
            <span className="tabular-nums text-ink-faint">{group.items.length}</span>
          </span>
        ))}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer select-none text-xs text-seal hover:underline">
          展开全部 {total} 个工具的名字与用途
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          {groups.map((group) => (
            <CapabilityGroup key={group.key} label={group.label} items={group.items} />
          ))}
        </div>
      </details>
    </div>
  );
}

/** One subject and the tools under it. */
function CapabilityGroup({ label, items }: { label: string; items: McpCapability[] }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <h3 className="font-kai text-sm text-ink">{label}</h3>
        <span className="text-[10px] text-ink-faint tabular-nums">{items.length} 项</span>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {items.map((item) => (
          <li
            key={item.name}
            className="rounded-md border border-ink/10 bg-paper-soft px-3 py-2 min-w-0"
          >
            <div className="flex items-baseline gap-2 min-w-0">
              <code className="text-[11px] font-mono text-seal truncate">{item.name}</code>
              <span className="text-[10px] text-ink-faint truncate">{item.title}</span>
            </div>
            <p className="text-xs text-ink-soft mt-0.5 leading-relaxed">{item.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
