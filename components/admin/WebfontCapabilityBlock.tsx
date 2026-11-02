'use client';

import { Panel } from '@/components/admin/Panel';
import type { CapabilityReport } from '@/components/admin/webfont-pipeline-types';

/**
 * Block ① of the admin font pipeline: what this machine can do.
 *
 * ⚠️ **The report is rendered even when its verdict is `ok: false`.** The
 * probe answers `200` with a verdict, not a transport failure ⇒ the remedy
 * is the whole point of the block, and a house
 * `if (!res.ok || !data.ok) throw` would have thrown it away.
 *
 * The two disk paths are BOTH shown: `stagingDir` is ①'s download staging
 * directory and `fontDir` is the font root — they are not the same
 * directory, and an operator who confuses them cleans up the wrong one.
 */
export interface WebfontCapabilityBlockProps {
  /** The report of the probe, or `null` while it has not answered yet. */
  capability: CapabilityReport | null;
  /** The transport failure, if the probe could not be reached at all. */
  capabilityError: string | null;
}

export default function WebfontCapabilityBlock({
  capability,
  capabilityError,
}: WebfontCapabilityBlockProps): React.JSX.Element {
  return (
    <Panel title="构建能力" description="这台机器齐备吗？缺什么、怎么装，都在这里。">
      {capabilityError ? (
        <p className="rounded border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
          {capabilityError}
        </p>
      ) : null}

      {!capability ? (
        !capabilityError && <p className="text-sm text-ink-faint">正在探测…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="构建能力探针">
              <tbody>
                <CapabilityRow name="Node" ok={true} detail={capability.node} />
                <CapabilityRow
                  name="Python"
                  ok={capability.python.available}
                  detail={
                    capability.python.available
                      ? (capability.python.version ?? '')
                      : (capability.python.error ?? '不可用')
                  }
                />
                <CapabilityRow
                  name="fontTools"
                  ok={capability.fonttools.available}
                  detail={
                    capability.fonttools.available
                      ? (capability.fonttools.version ?? '')
                      : (capability.fonttools.error ?? capability.fonttools.remedy ?? '不可用')
                  }
                />
                <CapabilityRow
                  name="上游可达"
                  ok={capability.network.available}
                  detail={
                    capability.network.available
                      ? capability.network.checkedUrl
                      : (capability.network.error ?? '连不上')
                  }
                />
                <CapabilityRow
                  name="磁盘可写"
                  ok={capability.disk.available}
                  detail={
                    capability.disk.available
                      ? `① 的下载暂存目录 ${capability.disk.stagingDir}；字体根目录 ${capability.disk.fontDir}`
                      : (capability.disk.error ?? '不可写')
                  }
                />
                <CapabilityRow
                  name="构建工具链"
                  ok={
                    capability.toolchain.subsetFont &&
                    capability.toolchain.typescript &&
                    capability.toolchain.tsx
                  }
                  detail={
                    capability.toolchain.subsetFont &&
                    capability.toolchain.typescript &&
                    capability.toolchain.tsx
                      ? 'subset-font / typescript / tsx 都齐'
                      : 'subset-font / typescript / tsx 没装齐'
                  }
                />
              </tbody>
            </table>
          </div>

          {capability.missing.length > 0 ? (
            <div className="mt-3 rounded border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
              <p className="font-medium">这台机器还不能构建字体：</p>
              <ul className="mt-1 list-disc pl-5 space-y-1">
                {capability.missing.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/** One row of the capability table. */
function CapabilityRow({
  name,
  ok,
  detail,
}: {
  name: string;
  ok: boolean;
  detail: string;
}): React.JSX.Element {
  return (
    <tr className="border-b border-ink/5">
      <th scope="row" className="w-28 py-1.5 pr-3 text-left font-normal text-ink-soft">
        {name}
      </th>
      <td className="w-16 py-1.5 pr-3">
        <span className={ok ? 'text-success' : 'text-danger'}>{ok ? '齐备' : '缺失'}</span>
      </td>
      <td className="py-1.5 text-xs text-ink-faint">
        <span className="break-all">{detail}</span>
      </td>
    </tr>
  );
}
