import type { ReactNode } from 'react';

export interface FormFieldProps {
  /** The field's label. */
  label: ReactNode;
  /** The id of the control the label points at. */
  htmlFor?: string;
  /** A short line under the control. */
  hint?: ReactNode;
  /** An error message. Takes the place of the hint. */
  error?: ReactNode;
  /** The control itself — an input, a select, a textarea. */
  children: ReactNode;
  className?: string;
}

/**
 * A labelled form control.
 *
 * The admin forms each spelled out their own label markup: some used a
 * `<span className="text-xs text-ink-soft">`, some used `<label>` with the
 * text inside, and the hint/error line was either missing or styled
 * differently every time. This is the one shape, so a reader sees the same
 * label above every field and the same error treatment everywhere.
 */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = '',
}: FormFieldProps) {
  return (
    <label className={`block ${className}`} htmlFor={htmlFor}>
      <span className="block text-xs text-ink-soft mb-1">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs text-danger mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-ink-faint mt-1">{hint}</span>
      ) : null}
    </label>
  );
}
