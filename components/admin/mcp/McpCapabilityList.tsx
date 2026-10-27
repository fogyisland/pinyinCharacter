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
 * Every entry carries the tool's name (what an AI client calls it), its
 * registered title and one Chinese line saying what it answers.
 */
export function McpCapabilityList() {
  const groups = groupCapabilitiesByCategory(MCP_CAPABILITIES);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <CapabilityGroup key={group.key} label={group.label} items={group.items} />
      ))}
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
