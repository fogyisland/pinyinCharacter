'use client';

/**
 * The admin font pipeline panel.
 *
 * Four blocks: 能力 / 构建 / 应用 / release 列表. The first and the third
 * live in their own files (`WebfontCapabilityBlock`, `WebfontApplyBlock`),
 * because each of them is longer than the rest of this file put together;
 * the shared shapes are in `webfont-pipeline-types.ts`.
 *
 * ## What this panel is careful about
 *
 *  - **The capability probe answers `200` with `ok: false`** when the machine
 *    is missing something. That is a verdict, not a transport failure ⇒ the
 *    report is rendered ANYWAY, because the remedy is the whole point. The
 *    house `if (!res.ok || !data.ok) throw` pattern is used for every OTHER
 *    endpoint, and deliberately NOT for this one.
 *  - **The backend decides what may be cleaned** (`canClean`). The page never
 *    re-derives it; a missing verdict renders as 「—」, never as `false`.
 *  - **The backend never writes into the repository.** There is no button
 *    that rewrites a budget, a pinned number, or a file. The re-base list is
 *    read-only: it says what a human has to change.
 *  - **A release that was never on the disk was not deleted.** The cleanup
 *    answer distinguishes the two, and so does this panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Play, Trash2, X } from 'lucide-react';

import { AdminButton } from '@/components/admin/AdminButton';
import { Panel } from '@/components/admin/Panel';
import WebfontApplyBlock from '@/components/admin/WebfontApplyBlock';
import WebfontCapabilityBlock from '@/components/admin/WebfontCapabilityBlock';
import {
  DASH,
  errorMessage,
  formatBytes,
  formatNumber,
} from '@/components/admin/webfont-pipeline-types';
import type {
  ApplyResponse,
  CapabilityReport,
  CleanupEntry,
  ReleaseEntry,
} from '@/components/admin/webfont-pipeline-types';
// ⚠️ TYPE-ONLY. `lib/webfont/jobs.ts` reaches `@/lib/db` (mysql2) — a VALUE
// import would drag mysql2 into the browser bundle.
import type { WebfontJob } from '@/lib/webfont/jobs';

/** The poll interval of the job chain, in milliseconds. */
const POLL_INTERVAL_MS = 1500;

/** The status a job can no longer move away from. */
const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

export interface WebfontPipelinePanelProps {
  /** The last jobs, handed over by the server so the first paint needs no round trip. */
  initialJobs?: WebfontJob[];
}

export default function WebfontPipelinePanel({
  initialJobs,
}: WebfontPipelinePanelProps): React.JSX.Element {
  const jobs = useMemo(() => initialJobs ?? [], [initialJobs]);

  // ── the capability probe ───────────────────────────────────────────────
  const [capability, setCapability] = useState<CapabilityReport | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);

  // ── the build ──────────────────────────────────────────────────────────
  const [activeJob, setActiveJob] = useState<WebfontJob | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // ── the apply ──────────────────────────────────────────────────────────
  const [applied, setApplied] = useState<ApplyResponse | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── the release ledger ─────────────────────────────────────────────────
  const [releases, setReleases] = useState<ReleaseEntry[]>([]);
  const [releasesBytes, setReleasesBytes] = useState(0);
  const [releasesKeep, setReleasesKeep] = useState('');
  const [cleanupResult, setCleanupResult] = useState<{
    removed: CleanupEntry[];
    kept: string[];
    repoHint?: string;
  } | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  // The timer of the poll chain — one at a time, cleared on unmount.
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollTimer.current !== null) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, []);

  // ── the capability report ──────────────────────────────────────────────
  //
  // ⚠️ This fetch does NOT use the house `if (!res.ok || !data.ok) throw`
  // pattern. The probe answers `200` with `ok: false` when the machine is
  // missing something — that is the verdict the page has to show, together
  // with its remedy.
  const loadCapability = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/webfonts/capability', { cache: 'no-store' });
      if (!res.ok) {
        setCapabilityError('能力探针请求失败（HTTP ' + res.status + '）');
        return;
      }
      const data = (await res.json()) as CapabilityReport;
      if (!mounted.current) return;
      setCapability(data);
      setCapabilityError(null);
    } catch (error) {
      if (!mounted.current) return;
      setCapabilityError('能力探针请求失败：' + (error as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadCapability();
  }, [loadCapability]);

  // ── the release ledger ─────────────────────────────────────────────────
  const loadReleases = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/webfonts/releases', { cache: 'no-store' });
      const data = (await res.json()) as {
        ok?: boolean;
        releases?: ReleaseEntry[];
        bytes?: number;
        keep?: string;
      };
      if (!res.ok || !data.ok) {
        if (!mounted.current) return;
        setCleanupError(errorMessage(data, '读取 release 台账失败'));
        return;
      }
      if (!mounted.current) return;
      setReleases(data.releases ?? []);
      setReleasesBytes(typeof data.bytes === 'number' ? data.bytes : 0);
      setReleasesKeep(typeof data.keep === 'string' ? data.keep : '');
    } catch (error) {
      if (!mounted.current) return;
      setCleanupError('读取 release 台账失败：' + (error as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadReleases();
  }, [loadReleases]);

  // ── the incremental log ────────────────────────────────────────────────
  //
  // The transcript is append-only ⇒ only the tail that was not rendered yet
  // is added, and the lines that are already on the screen are left alone.
  //
  // ⚠️ The previous transcript lives in a REF, not in state: the poll
  // chain's timer holds the closure it was created with, so a state counter
  // would be read stale and the same lines would be appended again and
  // again. Diffing against the raw text also gets the trailing newline
  // right — a counter would have to know whether the last line is finished.
  const logTranscriptRef = useRef('');
  const appendLog = useCallback((transcript: string) => {
    if (!transcript) return;
    const previous = logTranscriptRef.current;
    logTranscriptRef.current = transcript;
    // A transcript that does not start with the previous one was rewritten
    // (a new job, a purged log) ⇒ the screen starts over with it.
    if (!transcript.startsWith(previous)) {
      setLogLines([]);
    }
    const fresh = transcript
      .slice(previous.length)
      .split('\n')
      .filter((line) => line !== '');
    if (fresh.length === 0) return;
    setLogLines((current) => [...current, ...fresh]);
  }, []);

  // ── the poll chain ─────────────────────────────────────────────────────
  //
  // ⚠️ A `setTimeout` CHAIN, not an interval: one timer at a time, scheduled
  // after the previous answer was handled. The chain stops at a terminal
  // status, and every fetch has a `.catch`.
  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const pollJob = useCallback(
    (jobId: string) => {
      stopPolling();
      pollTimer.current = setTimeout(() => {
        pollTimer.current = null;
        void (async () => {
          try {
            const res = await fetch(`/api/admin/webfonts/build/${jobId}`, { cache: 'no-store' });
            const data = (await res.json()) as { ok?: boolean; job?: WebfontJob };
            if (!mounted.current) return;
            if (!res.ok || !data.ok || !data.job) {
              setBuildError(errorMessage(data, '读取构建作业失败'));
              return;
            }
            const job = data.job;
            setActiveJob(job);
            appendLog(job.log ?? '');
            if (TERMINAL_STATUSES.has(job.status)) return;
            pollJob(jobId);
          } catch (error) {
            if (!mounted.current) return;
            setBuildError('读取构建作业失败：' + (error as Error).message);
          }
        })();
      }, POLL_INTERVAL_MS);
    },
    [appendLog, stopPolling],
  );

  // ── the actions ────────────────────────────────────────────────────────
  const startBuild = useCallback(async () => {
    setBusy(true);
    setBuildError(null);
    setNotice(null);
    setApplied(null);
    setApplyError(null);
    setLogLines([]);
    logTranscriptRef.current = '';
    try {
      // ⚠️ An EMPTY body — the route takes no parameters, and a body of
      // `JSON.stringify({})` with a JSON content type trips `req.json()`.
      const res = await fetch('/api/admin/webfonts/build', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; jobId?: string };
      if (!mounted.current) return;
      if (!res.ok || !data.ok || !data.jobId) {
        setBuildError(errorMessage(data, '开始构建失败'));
        return;
      }
      setNotice('构建已开始；作业仍在运行，离开本页不会取消它');
      pollJob(data.jobId);
    } catch (error) {
      if (!mounted.current) return;
      setBuildError('开始构建失败：' + (error as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [pollJob]);

  const cancelBuild = useCallback(async () => {
    if (!activeJob) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/webfonts/build/${activeJob.id}/cancel`, {
        method: 'POST',
      });
      const data = (await res.json()) as { ok?: boolean; job?: WebfontJob };
      if (!mounted.current) return;
      if (!res.ok || !data.ok) {
        setBuildError(errorMessage(data, '取消失败'));
        return;
      }
      setActiveJob(data.job ?? { ...activeJob, status: 'cancelled' });
      setNotice('已取消；正在跑的那一步会自己跑完');
    } catch (error) {
      if (!mounted.current) return;
      setBuildError('取消失败：' + (error as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [activeJob]);

  const applyBuild = useCallback(async () => {
    if (!activeJob) return;
    setBusy(true);
    setApplyError(null);
    try {
      const res = await fetch(`/api/admin/webfonts/build/${activeJob.id}/apply`, {
        method: 'POST',
      });
      const data = (await res.json()) as ApplyResponse | { ok?: boolean; error?: unknown };
      if (!mounted.current) return;
      if (!res.ok || !data.ok) {
        setApplyError(errorMessage(data, '应用失败'));
        return;
      }
      setApplied(data as ApplyResponse);
      setNotice('已应用；产物已发布到服务器，但尚未回灌仓库');
      void loadReleases();
    } catch (error) {
      if (!mounted.current) return;
      setApplyError('应用失败：' + (error as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [activeJob, loadReleases]);

  const cleanupReleases = useCallback(async () => {
    setBusy(true);
    setCleanupError(null);
    setCleanupResult(null);
    try {
      const res = await fetch('/api/admin/webfonts/releases/cleanup', { method: 'POST' });
      const data = (await res.json()) as {
        ok?: boolean;
        removed?: CleanupEntry[];
        kept?: string[];
        repoHint?: string;
      };
      if (!mounted.current) return;
      if (!res.ok || !data.ok) {
        setCleanupError(errorMessage(data, '没有可清理的 release'));
        return;
      }
      setCleanupResult({
        removed: data.removed ?? [],
        kept: data.kept ?? [],
        ...(typeof data.repoHint === 'string' ? { repoHint: data.repoHint } : {}),
      });
      void loadReleases();
    } catch (error) {
      if (!mounted.current) return;
      setCleanupError('清理失败：' + (error as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [loadReleases]);

  const copyCommand = useCallback(async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      if (!mounted.current) return;
      setCopied(true);
    } catch (error) {
      // ⚠️ `clipboard.writeText` rejects without a secure context ⇒ the text
      // stays on the screen and the operator can select it by hand. The
      // rejection is NEVER left unhandled.
      if (!mounted.current) return;
      setCopied(false);
      setNotice('浏览器不允许自动复制，请手动选中命令复制');
      console.error('[webfont] copying the re-import command failed:', (error as Error).message);
    }
  }, []);

  // ── the derived state ──────────────────────────────────────────────────
  const job = activeJob ?? jobs[0] ?? null;
  const jobIsRunning = job !== null && (job.status === 'pending' || job.status === 'running');
  const capabilityOk = capability?.ok === true;
  const buildDisabled = !capabilityOk || busy || jobIsRunning;

  return (
    <div className="space-y-5">
      {/* ── ① the capability ─────────────────────────────────────────── */}
      <WebfontCapabilityBlock capability={capability} capabilityError={capabilityError} />

      {/* ── ② the build ──────────────────────────────────────────────── */}
      <Panel
        title="构建"
        description="① 下载 → ② 裁轴 → ③ 切分 → ④ 校验。构建只写暂存目录，不碰线上。"
        actions={
          <>
            <AdminButton
              variant="primary"
              size="sm"
              icon={<Play className="h-3.5 w-3.5" />}
              onClick={() => void startBuild()}
              disabled={buildDisabled}
            >
              开始构建
            </AdminButton>
            <AdminButton
              variant="secondary"
              size="sm"
              icon={<X className="h-3.5 w-3.5" />}
              onClick={() => void cancelBuild()}
              disabled={!jobIsRunning || busy}
            >
              取消
            </AdminButton>
            <AdminButton
              variant="success"
              size="sm"
              icon={<Check className="h-3.5 w-3.5" />}
              onClick={() => void applyBuild()}
              disabled={!job || job.status !== 'done' || busy}
            >
              应用
            </AdminButton>
          </>
        }
      >
        {buildDisabled && capability && !capabilityOk ? (
          <p className="mb-3 text-xs text-danger">
            能力探针报「这台机器还缺东西」，所以「开始构建」不可点 —— 缺什么见上面那一块。
          </p>
        ) : null}
        {jobIsRunning ? (
          <p className="mb-3 text-xs text-ink-soft">作业仍在运行，离开本页不会取消它。</p>
        ) : null}
        {buildError ? (
          <p className="mb-3 rounded border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
            {buildError}
          </p>
        ) : null}
        {job?.error ? (
          <p className="mb-3 rounded border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
            {job.error}
          </p>
        ) : null}
        {notice ? <p className="mb-3 text-sm text-success">{notice}</p> : null}

        {job ? (
          <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-faint">作业</dt>
              <dd className="font-mono text-xs">{job.id}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">状态</dt>
              <dd>{job.status}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">步骤</dt>
              <dd>
                {job.step || DASH}
                {job.stepProgress ? ` ${job.stepProgress}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">说明</dt>
              <dd>{job.message || DASH}</dd>
            </div>
          </dl>
        ) : (
          <p className="mb-3 text-sm text-ink-faint">还没有构建作业。</p>
        )}

        {logLines.length > 0 ? (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-ink/10 bg-paper-soft/50 p-3 font-mono text-xs leading-relaxed">
            {logLines.join('\n')}
          </pre>
        ) : null}
      </Panel>

      {/* ── ③ the apply ──────────────────────────────────────────────── */}
      {applied ? (
        <WebfontApplyBlock
          applied={applied}
          applyError={applyError}
          copied={copied}
          onCopy={(command) => void copyCommand(command)}
        />
      ) : null}

      {/* ── ④ the release ledger ─────────────────────────────────────── */}
      <Panel
        title="release 列表"
        description={releasesKeep || '哪些旧 release 可以清理，由后台算。'}
        actions={
          <AdminButton
            variant="danger"
            size="sm"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => void cleanupReleases()}
            disabled={busy}
          >
            清理 release
          </AdminButton>
        }
      >
        {cleanupError ? (
          <p className="mb-3 rounded border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
            {cleanupError}
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="release 台账">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink-faint">
                <th className="py-1 pr-3 font-normal">目录名</th>
                <th className="py-1 pr-3 font-normal">发布时间</th>
                <th className="py-1 pr-3 font-normal">被取代时间</th>
                <th className="py-1 pr-3 font-normal">文件数</th>
                <th className="py-1 pr-3 font-normal">字节数</th>
                <th className="py-1 pr-3 font-normal">可否清理</th>
              </tr>
            </thead>
            <tbody>
              {releases.length === 0 ? (
                <tr>
                  <td className="py-2 text-ink-faint" colSpan={6}>
                    台账里还没有 release。
                  </td>
                </tr>
              ) : null}
              {releases.map((release) => (
                <tr key={release.dir} className="border-b border-ink/5">
                  <td className="py-1 pr-3 font-mono text-xs">{release.dir}</td>
                  <td className="py-1 pr-3 text-xs">{release.publishedAt || DASH}</td>
                  <td className="py-1 pr-3 text-xs">{release.supersededAt ?? DASH}</td>
                  <td className="py-1 pr-3">{formatNumber(release.files)}</td>
                  <td className="py-1 pr-3">{formatBytes(release.bytes)}</td>
                  <td className="py-1 pr-3">
                    {typeof release.canClean === 'boolean' ? (release.canClean ? '是' : '否') : DASH}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-xs text-ink-faint">
          release 目录共占用 {formatBytes(releasesBytes)}。apply 从不删任何东西 —— 删除只能是上面那个「清理 release」。
        </p>

        {cleanupResult ? (
          <div className="mt-3 rounded border border-ink/10 bg-paper-soft/40 px-3 py-2 text-sm">
            <h3 className="font-kai text-base text-ink">清理结果</h3>
            <ul className="mt-1 space-y-1">
              {cleanupResult.removed.map((entry) => (
                <li key={entry.dir}>
                  <span className="font-mono text-xs">{entry.dir}</span> —{' '}
                  {entry.removed ? (
                    <span className="text-success">已删除（腾出 {formatBytes(entry.bytes)}）</span>
                  ) : (
                    <span className="text-danger">本来就不在盘上（未删除）</span>
                  )}
                </li>
              ))}
            </ul>
            {cleanupResult.kept.length > 0 ? (
              <p className="mt-2 text-xs text-ink-soft">保留：{cleanupResult.kept.join('、')}</p>
            ) : null}
            {cleanupResult.repoHint ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger/8 px-2 py-1.5 text-xs text-danger">
                {cleanupResult.repoHint}
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
