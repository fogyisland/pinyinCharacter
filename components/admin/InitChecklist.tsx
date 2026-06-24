import { Check, AlertTriangle, X } from 'lucide-react';
import type { InitReport, StepStatus } from '@/lib/init-checklist';

const STATUS_ICON: Record<StepStatus, React.ReactNode> = {
  ok: <Check className="h-4 w-4 text-green-700" aria-label="ok" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="warn" />,
  fail: <X className="h-4 w-4 text-seal" aria-label="fail" />,
};

const STATUS_LABEL: Record<StepStatus, string> = {
  ok: '完成',
  warn: '建议',
  fail: '必须修复',
};

const STATUS_ROW: Record<StepStatus, string> = {
  ok: 'border-green-200 bg-green-50/40',
  warn: 'border-amber-200 bg-amber-50/40',
  fail: 'border-seal/30 bg-seal/5',
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
  const okCount = steps.filter(s => s.status === 'ok').length;
  const warnCount = steps.filter(s => s.status === 'warn').length;
  const failCount = steps.filter(s => s.status === 'fail').length;

  return (
    <div className="space-y-6">
      {/* Section 1: Current environment */}
      <section className="card-paper rounded-lg p-4">
        <h2 className="text-base font-semibold mb-3">当前环境</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-ink-soft">运行环境</dt>
            <dd className="font-mono">
              {context.nodeEnv}
              {context.isProd ? ' (production)' : ' (development)'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">数据库</dt>
            <dd className="font-mono text-xs">
              {context.dbUrlParts ? (
                <>
                  {context.dbUrlParts.user}@{context.dbUrlParts.host}:{context.dbUrlParts.port}/{context.dbUrlParts.database}
                  {' '}<span className="text-ink-soft">(密码 {context.dbUrlParts.password})</span>
                </>
              ) : (
                <span className="text-seal">无法解析 DATABASE_URL</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">JWT_SECRET</dt>
            <dd className="font-mono text-xs">
              {context.jwtSecretLength} 字节
              {context.jwtSecretIsDevDefault && (
                <span className="ml-2 text-amber-700">⚠ dev 默认值,prod 不可用</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">表数量</dt>
            <dd className="font-mono text-xs">
              {context.tableCount} 张
              {context.tableCount < context.expectedTableCount && (
                <span className="ml-2 text-seal">(期望 ≥ {context.expectedTableCount})</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* Section 2: Admin account */}
      <section className="card-paper rounded-lg p-4">
        <h2 className="text-base font-semibold mb-3">管理员账户</h2>
        {context.adminCount === 0 ? (
          <p className="text-sm text-seal">无管理员 — 需注册后手动改 is_admin=1</p>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-ink-soft">管理员数</dt>
              <dd className="font-mono">{context.adminCount}</dd>
            </div>
            {context.firstAdmin && (
              <>
                <div>
                  <dt className="text-ink-soft">首个 admin</dt>
                  <dd className="font-mono">{context.firstAdmin.username}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">创建时间</dt>
                  <dd className="font-mono text-xs">
                    {new Date(context.firstAdmin.createdAt).toLocaleString('zh-CN')}
                  </dd>
                </div>
              </>
            )}
          </dl>
        )}
      </section>

      {/* Section 3: 12 init steps */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold">初始化步骤</h2>
          <p className="text-xs text-ink-soft">
            {okCount} 完成 · {warnCount} 建议 · {failCount} 必须修复
          </p>
        </div>
        <ul className="space-y-2">
          {steps.map(step => (
            <li
              key={step.id}
              data-testid={`step-${step.id}`}
              className={`flex items-start gap-3 rounded-md border p-3 ${STATUS_ROW[step.status]}`}
            >
              <span className="mt-0.5">
                {step.status === 'ok'
                  ? <Check className="h-5 w-5 text-green-700" />
                  : step.status === 'warn'
                    ? <AlertTriangle className="h-5 w-5 text-amber-600" />
                    : <X className="h-5 w-5 text-seal" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-sm">{step.name}</span>
                  <span className="text-xs text-ink-soft">
                    {step.required ? '必须' : '可选'} · {STATUS_LABEL[step.status]}
                  </span>
                </div>
                <p className="text-xs text-ink-soft mt-0.5">{step.description}</p>
                {step.details && (
                  <p className="text-xs font-mono mt-1 break-all">{step.details}</p>
                )}
              </div>
              {step.fixHref && (
                <a
                  href={step.fixHref}
                  className="text-xs px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep whitespace-nowrap"
                >
                  {step.fixLabel ?? '去修'}
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
