'use client';

import { Copy } from 'lucide-react';

import { AdminButton } from '@/components/admin/AdminButton';
import { Panel } from '@/components/admin/Panel';
import {
  DASH,
  formatBytes,
  formatNumber,
} from '@/components/admin/webfont-pipeline-types';
import type { ApplyResponse, RebaselineEntry } from '@/components/admin/webfont-pipeline-types';

/**
 * Block ③ of the admin font pipeline: what the apply did, and what a human
 * has to do next.
 *
 * Four things this block is careful about:
 *
 *  - **The two tokens differ on purpose.** T names the release directory, V
 *    is the manifest version the stylesheet's `?v=` will use. They are shown
 *    side by side, and the difference is stated as normal — not as an error.
 *  - **The HTML token only changes at the next build.** `lib/font-css.ts`
 *    reads the manifest at BUILD time ⇒ the stylesheet file is already new,
 *    but the token inside the HTML is not. The page says so.
 *  - **The page cost is shown NEW beside OLD.** The budget describes the
 *    LIVE tree, so the new measurements sit next to the old budget, and
 *    the lines a human has to change are named.
 *  - **Nothing here writes into the repository.** The re-base list is
 *    read-only: a button that rewrote a pinned number would be a green
 *    light nobody reviewed.
 */
export interface WebfontApplyBlockProps {
  /** The answer of the apply. */
  applied: ApplyResponse;
  /** The failure of the apply, if it failed. */
  applyError: string | null;
  /** Whether the re-import command was copied. */
  copied: boolean;
  /** Copies the re-import command to the clipboard. */
  onCopy: (command: string) => void;
}

export default function WebfontApplyBlock({
  applied,
  applyError,
  copied,
  onCopy,
}: WebfontApplyBlockProps): React.JSX.Element {
  // ⚠️ A local const, so the narrowing survives the `.map` callback below.
  const pageCost = applied.pageCost ?? null;

  return (
    <Panel title="应用结果" description="产物已经发布到服务器；仓库还没有跟上。">
      {applyError ? (
        <p className="rounded border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
          {applyError}
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-ink-faint">发布令牌 T（这一批字体文件放在哪个目录）</dt>
          <dd className="font-mono text-sm">{applied.releaseToken}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">
            清单版本 V（HTML 里样式表的 <code>?v=</code> 会用它）
          </dt>
          <dd className="font-mono text-sm">{applied.manifestVersion}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">发布目录</dt>
          <dd className="font-mono text-sm">{applied.releaseDir}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-ink-soft">
        T ≠ V 是正常的：T 是改写前的样式表哈希，V 是改写后的。两者的不同不是异常。
      </p>

      {applied.summary ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm" aria-label="产物差异">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                <th className="py-1 pr-3 font-normal">口径</th>
                <th className="py-1 pr-3 font-normal">文件数</th>
                <th className="py-1 pr-3 font-normal">总字节</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-ink/5">
                <td className="py-1 pr-3">线上那份（发布前）</td>
                <td className="py-1 pr-3">{formatNumber(applied.summary.liveFiles)}</td>
                <td className="py-1 pr-3">{formatBytes(applied.summary.liveBytes)}</td>
              </tr>
              <tr className="border-b border-ink/5">
                <td className="py-1 pr-3">新产物</td>
                <td className="py-1 pr-3">{formatNumber(applied.summary.newFiles)}</td>
                <td className="py-1 pr-3">{formatBytes(applied.summary.newBytes)}</td>
              </tr>
              <tr>
                <td className="py-1 pr-3">新发布目录占用</td>
                <td className="py-1 pr-3">{DASH}</td>
                <td className="py-1 pr-3">{formatBytes(applied.summary.releaseBytes)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="mt-3 rounded border border-ink/10 bg-paper-soft/40 px-3 py-2 text-sm text-ink-soft">
        样式表文件已经更新了（访客下次请求就会拿到新的），但{' '}
        <strong className="text-ink">HTML 里的令牌要等下一次构建/部署</strong>
        才更新；现在不影响正确性，只是新版本还没有被令牌化。
      </p>

      <p className="mt-2 rounded border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
        apply 只改服务器上的文件，<strong>不会</strong>自动 commit；要把仓库与线上一致，请把{' '}
        <code className="font-mono">public/font/</code> 的变更提交并部署。
      </p>

      {applied.reimport.required ? (
        <div className="mt-3 rounded border border-danger/30 bg-danger/8 px-3 py-3">
          <h3 className="font-kai text-base text-danger">产物已发布，但尚未回灌仓库</h3>
          <p className="mt-1 text-sm text-danger">
            不回灌 ⇒ 下次部署会用仓库里的旧样式表覆盖服务器上的新样式表 ={' '}
            <strong className="text-danger">静默回滚</strong>（页面显示「已发布」，线上其实是旧字体，
            manifest 版本也被覆盖回去）。
          </p>
          <div className="mt-2 flex items-start gap-2">
            <code className="font-mono block flex-1 overflow-x-auto rounded bg-paper-soft px-2 py-1.5 text-xs text-ink">
              {applied.reimport.command}
            </code>
            <AdminButton
              variant="secondary"
              size="sm"
              icon={<Copy className="h-3.5 w-3.5" />}
              onClick={() => onCopy(applied.reimport.command)}
            >
              复制命令
            </AdminButton>
          </div>
          {copied ? <p className="mt-1 text-xs text-success">命令已复制。</p> : null}
          <p className="mt-2 text-sm font-medium text-danger">回灌之前不要部署。</p>
        </div>
      ) : null}

      {pageCost ? (
        <div className="mt-4">
          <h3 className="font-kai text-base text-ink">页面成本：新旧并排</h3>
          <p className="mt-1 text-xs text-ink-soft">
            这一组预算描述的是<strong className="text-ink">线上那一份</strong>
            产物；apply 之后服务器树里的 <code className="font-mono">npm run fonts:verify-webfont</code>{' '}
            会变红 —— 那是漂移探测器在正常工作，不是 bug。修法是
            <strong className="text-ink">人工</strong>把{' '}
            <code className="font-mono">scripts/fonts/verify-webfont-subsets.mjs</code> 里的{' '}
            <code className="font-mono">LIMITS.unionSampleBytes</code> /{' '}
            <code className="font-mono">LIMITS.maxUnionSampleFilesPerPage</code>{' '}
            更新成新的实测值。
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm" aria-label="页面成本">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                  <th className="py-1 pr-3 font-normal">页面</th>
                  <th className="py-1 pr-3 font-normal">新的实测字节</th>
                  <th className="py-1 pr-3 font-normal">旧预算字节</th>
                  <th className="py-1 pr-3 font-normal">新的实测文件数</th>
                  <th className="py-1 pr-3 font-normal">旧预算文件数</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(pageCost.bytes).map((page) => (
                  <tr key={page} className="border-b border-ink/5">
                    <td className="py-1 pr-3 font-mono text-xs">{page}</td>
                    <td className="py-1 pr-3">{formatBytes(pageCost.bytes[page] ?? 0)}</td>
                    <td className="py-1 pr-3">
                      {pageCost.budgetBytes[page] === undefined
                        ? DASH
                        : formatBytes(pageCost.budgetBytes[page])}
                    </td>
                    <td className="py-1 pr-3">
                      {pageCost.files[page] === undefined
                        ? DASH
                        : formatNumber(pageCost.files[page])}
                    </td>
                    <td className="py-1 pr-3">{formatNumber(pageCost.budgetFiles)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {applied.rebaseline.length > 0 ? (
        <div className="mt-4">
          <h3 className="font-kai text-base text-ink">apply 之后要重标定的钉死数字</h3>
          <p className="mt-1 text-xs text-ink-soft">
            下面这张表是<strong className="text-ink">只读</strong>的 —— 后台一个字都不许替人写进仓库
            （自动改预算就是假绿灯）。改法是人工在评审过的提交里改。
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm" aria-label="要重标定的钉死数字">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                  <th className="py-1 pr-3 font-normal">文件:行</th>
                  <th className="py-1 pr-3 font-normal">钉的是什么</th>
                  <th className="py-1 pr-3 font-normal">现在钉的是几</th>
                  <th className="py-1 pr-3 font-normal">新的该是多少</th>
                </tr>
              </thead>
              <tbody>
                {applied.rebaseline.map((entry, index) => (
                  <tr key={`${entry.file}:${entry.line}:${index}`} className="border-b border-ink/5">
                    <td className="py-1 pr-3 font-mono text-xs">
                      {entry.file}:{entry.line}
                    </td>
                    <td className="py-1 pr-3">
                      {entry.what}
                      {entry.always ? '（每次回灌都要改）' : ''}
                      {entry.note ? (
                        <span className="block text-xs text-ink-faint">{entry.note}</span>
                      ) : null}
                    </td>
                    <td className="py-1 pr-3">{formatValue(entry.current)}</td>
                    <td className="py-1 pr-3">{expectedText(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/** Renders a pinned number, whatever shape it has. */
function formatValue(value: number | number[] | string | null): string {
  if (value === null) return DASH;
  if (Array.isArray(value)) return value.map((entry) => formatNumber(entry)).join(' / ');
  if (typeof value === 'number') return formatNumber(value);
  return value;
}

/**
 * The text of the 「新的该是多少」 column.
 *
 * ⚠️ Three states, and they are NOT the same:
 *  - `expected` is a number ⇒ the new value;
 *  - `expected === null` and the note says 「未判定」 ⇒ 「未判定」 — the number
 *    was never measured, so nobody knows;
 *  - `expected === null` otherwise ⇒ 「不用改」.
 */
function expectedText(entry: RebaselineEntry): string {
  if (entry.expected !== null) return formatValue(entry.expected);
  if (entry.note && entry.note.includes('未判定')) return '未判定';
  return '不用改';
}
