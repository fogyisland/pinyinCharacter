import { Check, AlertTriangle, X } from 'lucide-react';
import type { InitReport, StepStatus } from '@/lib/init-checklist';
import { formatDateTime } from '@/lib/format';
import { Panel } from '@/components/admin/Panel';
import { StatusBadge, type BadgeTone } from '@/components/admin/StatusBadge';
import { AdminLink } from '@/components/admin/AdminButton';

const STATUS_LABEL: Record<StepStatus, string> = {
  ok: '完成',
  warn: '建议',
  fail: '必须修复',
};

const STATUS_TONE: Record<StepStatus, BadgeTone> = {
  ok: 'success',
  warn: 'warning',
  fail: 'danger',
};

const STATUS_ROW: Record<StepStatus, string> = {
  ok: 'border-success/30 bg-success/8',
  warn: 'border-warning/35 bg-warning/10',
  fail: 'border-danger/30 bg-danger/8',
};

const STATUS_ICON: Record<StepStatus, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  fail: 'text-danger',
};

/**
 * Read-only system health checklist for /admin/init.
 *
 * Renders three sections:
 * 1. Current environment — DB URL (host/port/db/user, password masked),
 *    JWT_SECRET status (length + dev default), Node env.
 * 2. Admin account — count + first admin username + created_at.
 * 3. 12 auto-checked init steps with ✓ / ⚠ / ✗ icons. Each step
 *    has a "去修" link if there's a UI page to fix it.
 */
export function InitChecklist({ report }: { report: InitReport }) {
  const { context, steps } = report;
  const okCount = steps.filter((s) => s.status === 'ok').length;
  const warnCount = steps.filter((s) => s.status === 'warn').length;
  const failCount = steps.filter((s) => s.status === 'fail').length;

  return (
    <div className="space-y-4">
      {/* Section 1: Current environment */}
      <Panel title="当前环境" description="运行配置与数据库连通性">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-ink-soft">运行环境</dt>
            <dd className="font-mono text-ink">
              {context.nodeEnv}
              {context.isProd ? ' (production)' : ' (development)'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">数据库</dt>
            <dd className="font-mono text-xs">
              {context.dbUrlParts ? (
                <>
                  {context.dbUrlParts.user}@{context.dbUrlParts.host}:{context.dbUrlParts.port}/
                  {context.dbUrlParts.database}{' '}
                  <span className="text-ink-faint">(密码 {context.dbUrlParts.password})</span>
                </>
              ) : (
                <span className="text-danger">无法解析 DATABASE_URL</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">JWT_SECRET</dt>
            <dd className="font-mono text-xs">
              {context.jwtSecretLength} 字节
              {context.jwtSecretIsDevDefault && (
                <span className="ml-2 text-warning">⚠ dev 默认值,prod 不可用</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">表数量</dt>
            <dd className="font-mono text-xs">
              {context.tableCount} 张
              {context.tableCount < context.expectedTableCount && (
                <span className="ml-2 text-danger">(期望 ≥ {context.expectedTableCount})</span>
              )}
            </dd>
          </div>
        </dl>
      </Panel>

      {/* Section 2: Admin account */}
      <Panel title="管理员账户" description="至少需要一位管理员才能进入后台">
        {context.adminCount === 0 ? (
          <p className="text-sm text-danger">无管理员 — 需注册后手动改 is_admin=1</p>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-ink-soft">管理员数</dt>
              <dd className="font-mono text-ink tabular-nums">{context.adminCount}</dd>
            </div>
            {context.firstAdmin && (
              <>
                <div>
                  <dt className="text-ink-soft">首个 admin</dt>
                  <dd className="font-mono text-ink">{context.firstAdmin.username}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">创建时间</dt>
                  <dd className="font-mono text-xs">
                    {formatDateTime(context.firstAdmin.createdAt)}
                  </dd>
                </div>
              </>
            )}
          </dl>
        )}
      </Panel>

      {/* Section 3: 12 init steps */}
      <Panel
        title="初始化步骤"
        description={`${okCount} 完成 · ${warnCount} 建议 · ${failCount} 必须修复`}
      >
        <ul className="space-y-2">
          {steps.map((step) => (
            <li
              key={step.id}
              data-testid={`step-${step.id}`}
              className={`flex items-start gap-3 rounded-md border p-3 ${STATUS_ROW[step.status]}`}
            >
              <span className="mt-0.5">
                {step.status === 'ok' ? (
                  <Check className={`h-5 w-5 ${STATUS_ICON.ok}`} />
                ) : step.status === 'warn' ? (
                  <AlertTriangle className={`h-5 w-5 ${STATUS_ICON.warn}`} />
                ) : (
                  <X className={`h-5 w-5 ${STATUS_ICON.fail}`} />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-ink">{step.name}</span>
                  <StatusBadge tone={STATUS_TONE[step.status]}>
                    {step.required ? '必须' : '可选'} · {STATUS_LABEL[step.status]}
                  </StatusBadge>
                </div>
                <p className="text-xs text-ink-soft mt-0.5">{step.description}</p>
                {step.details && (
                  <p className="text-xs font-mono mt-1 break-all text-ink-soft">{step.details}</p>
                )}
              </div>
              {step.fixHref && (
                <AdminLink href={step.fixHref} variant="secondary" size="sm">
                  {step.fixLabel ?? '去修'}
                </AdminLink>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
