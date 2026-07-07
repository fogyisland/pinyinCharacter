import { Check, Database, User, Rocket } from 'lucide-react';

const STEPS = [
  { id: 'db', label: '数据库', Icon: Database },
  { id: 'admin', label: '管理员', Icon: User },
  { id: 'execute', label: '初始化数据', Icon: Rocket },
] as const;

/** 3-step progress indicator for the /init wizard. Server component. */
export function InitHeader({ currentStep }: { currentStep: 0 | 1 | 2 }) {
  return (
    <div className="mb-8 flex items-center gap-2">
      {STEPS.map((s, i) => {
        const completed = i < currentStep;
        const active = i === currentStep;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                completed
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : active
                  ? 'border-seal bg-seal text-white'
                  : 'border-ink/20 bg-paper-soft text-ink-faint'
              }`}
            >
              {completed ? <Check className="h-4 w-4" /> : <s.Icon className="h-4 w-4" />}
            </div>
            <span
              className={`text-sm ${active || completed ? 'text-ink font-medium' : 'text-ink-faint'}`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="mx-2 text-ink-faint">→</span>}
          </div>
        );
      })}
    </div>
  );
}