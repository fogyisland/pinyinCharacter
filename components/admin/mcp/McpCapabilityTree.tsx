'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  groupCapabilitiesByCategory,
  MCP_CAPABILITIES,
  type McpCapability,
} from '@/mcp/capabilities';

/**
 * The catalogue of the MCP tools, as a tree.
 *
 * The operator's question is "what can this service do?", and the answer
 * is twenty tools spread over eight subjects. Shown as a flat list it is
 * a wall of twenty rows nobody reads; shown as a card grid it pushes the
 * token table off the screen. A tree answers it in the reader's own
 * order: open the subject you care about, then the tool inside it.
 *
 * Everything starts folded. The eight subjects and their counts are
 * always on screen — that is the summary — and the twenty tool names
 * are one click away, the way a directory is.
 *
 * The subject is the heading that folds; each tool folds in turn to
 * reveal what it answers. The tree is a client component because the
 * folds are state, and because one button has to open all of it.
 */

const CATEGORY_PREFIX = 'category:';
const TOOL_PREFIX = 'tool:';

export function McpCapabilityTree() {
  const groups = useMemo(() => groupCapabilitiesByCategory(MCP_CAPABILITIES), []);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());

  /** Every node of the tree, so "open all" has a list to work with. */
  const nodeIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of groups) {
      ids.push(`${CATEGORY_PREFIX}${group.key}`);
      for (const item of group.items) ids.push(`${TOOL_PREFIX}${item.name}`);
    }
    return ids;
  }, [groups]);

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openAll = () => setExpanded(new Set(nodeIds));
  const closeAll = () => setExpanded(new Set<string>());
  const isEverythingOpen = expanded.size === nodeIds.length && nodeIds.length > 0;

  return (
    <div data-testid="mcp-capability-tree">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs text-ink-faint">
          {groups.length} 个类别 · {MCP_CAPABILITIES.length} 个工具 · 默认折叠，点击标题展开
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={openAll}
            disabled={isEverythingOpen}
            className="text-xs text-seal hover:underline disabled:text-ink-faint disabled:no-underline"
          >
            全部展开
          </button>
          <span className="text-ink-faint/60" aria-hidden="true">
            /
          </span>
          <button
            type="button"
            onClick={closeAll}
            disabled={expanded.size === 0}
            className="text-xs text-seal hover:underline disabled:text-ink-faint disabled:no-underline"
          >
            全部收起
          </button>
        </div>
      </div>

      <ul className="flex flex-col gap-0.5">
        {groups.map((group) => {
          const categoryId = `${CATEGORY_PREFIX}${group.key}`;
          const categoryOpen = expanded.has(categoryId);
          return (
            <li key={group.key}>
              <button
                type="button"
                aria-expanded={categoryOpen}
                onClick={() => toggle(categoryId)}
                data-testid={`mcp-tree-category-${group.key}`}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-paper-deep/40"
              >
                <Chevron open={categoryOpen} />
                <span className="font-kai text-sm text-ink">{group.label}</span>
                <span className="text-[10px] text-ink-faint tabular-nums">
                  {group.items.length} 个工具
                </span>
              </button>

              {categoryOpen ? (
                <ul className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-ink/10 pl-3">
                  {group.items.map((item) => (
                    <ToolNode
                      key={item.name}
                      item={item}
                      open={expanded.has(`${TOOL_PREFIX}${item.name}`)}
                      onToggle={() => toggle(`${TOOL_PREFIX}${item.name}`)}
                    />
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One tool under its subject: the name is the heading, the summary is what it answers. */
function ToolNode({
  item,
  open,
  onToggle,
}: {
  item: McpCapability;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        data-testid={`mcp-tree-tool-${item.name}`}
        className="flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-paper-deep/40"
      >
        <Chevron open={open} />
        <code className="text-[11px] font-mono text-seal">{item.name}</code>
        <span className="truncate text-[11px] text-ink-faint">{item.title}</span>
      </button>
      {open ? (
        <p className="ml-6 mt-0.5 text-xs leading-relaxed text-ink-soft">{item.summary}</p>
      ) : null}
    </li>
  );
}

/** The fold marker. */
function Chevron({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
  );
}
