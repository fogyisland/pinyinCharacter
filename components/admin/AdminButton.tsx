import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-seal text-paper-soft border border-transparent hover:bg-seal/90',
  secondary: 'bg-paper-soft text-ink border border-ink/20 hover:bg-paper-deep',
  danger: 'bg-transparent text-danger border border-danger/40 hover:bg-danger/10',
  ghost: 'bg-transparent text-ink-soft border border-transparent hover:bg-paper-deep hover:text-ink',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'text-xs px-2.5 py-1 gap-1',
  md: 'text-sm px-3.5 py-1.5 gap-1.5',
};

function buttonClass(variant: ButtonVariant, size: ButtonSize, extra: string): string {
  return [
    'inline-flex items-center justify-center rounded font-normal whitespace-nowrap',
    'transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface AdminButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A leading icon. */
  icon?: ReactNode;
}

/**
 * The primary action button of the admin.
 *
 * The pages used `btn-seal` (which is 楷体 with wide letter spacing — it
 * belongs to the public site's call-to-action) for everything, including
 * small in-table buttons that were supposed to be quiet. This gives the
 * admin one hierarchy: a filled seal button for the main action, an
 * outlined one for secondary actions, a red outlined one for destructive
 * ones, and a borderless one for inline actions.
 */
export function AdminButton({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  type = 'button',
  ...rest
}: AdminButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export interface AdminLinkProps extends ComponentPropsWithoutRef<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

/** A link styled like `AdminButton`. */
export function AdminLink({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  ...rest
}: AdminLinkProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
