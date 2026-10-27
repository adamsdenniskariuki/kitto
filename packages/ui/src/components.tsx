import type { ReactNode } from 'react';
import { createElement, useId } from 'react';
import type {
  ComponentPropsWithoutRef,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { formatDate, formatDateTime, formatMoney, type TenantLocale } from '@kitto/core';
import { themeCss, type ColorScheme } from './themes';

/** Join class names, skipping falsy values. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ theme

/**
 * Renders a theme as CSS variables. The root layout renders the default; a
 * tenant layout renders the tenant's theme later in the document, which wins.
 */
export function ThemeStyle({ theme }: { theme?: string | null }) {
  return <style dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />;
}

/** Value for <html data-theme>: undefined lets the OS decide. */
export function htmlThemeAttr(scheme: ColorScheme): 'light' | 'dark' | undefined {
  return scheme === 'system' ? undefined : scheme;
}

// ---------------------------------------------------------------- buttons

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: 'md' | 'sm' = 'md',
  className?: string,
): string {
  return cn(`btn-${variant}`, size === 'sm' && 'btn-sm', className);
}

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

// ----------------------------------------------------------------- fields

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  /** Visually hide the label (it is still read by screen readers). */
  hideLabel?: boolean;
}

function useFieldIds(id: string | undefined, name: string | undefined) {
  const auto = useId();
  const base = id ?? (name ? `f-${name}` : auto);
  return { id: base, hintId: `${base}-hint`, errorId: `${base}-error` };
}

function describedBy(
  ids: ReturnType<typeof useFieldIds>,
  hint: unknown,
  error: unknown,
): string | undefined {
  return cn(hint ? ids.hintId : undefined, error ? ids.errorId : undefined) || undefined;
}

function FieldFrame({
  ids,
  label,
  hint,
  error,
  hideLabel,
  children,
  className,
}: FieldProps & {
  ids: ReturnType<typeof useFieldIds>;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={className}>
      <label htmlFor={ids.id} className={hideLabel ? 'sr-only' : 'label'}>
        {label}
      </label>
      {children}
      {hint && (
        <p id={ids.hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={ids.errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export type TextFieldProps = FieldProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> & { wrapperClassName?: string };

/** Labelled text input with hint and error wired up for screen readers. */
export function TextField({
  label,
  hint,
  error,
  hideLabel,
  id,
  className,
  wrapperClassName,
  ...props
}: TextFieldProps) {
  const ids = useFieldIds(id, props.name);
  return (
    <FieldFrame
      ids={ids}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      className={wrapperClassName}
    >
      <input
        id={ids.id}
        className={cn('input', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error)}
        {...props}
      />
    </FieldFrame>
  );
}

export type TextareaFieldProps = FieldProps &
  TextareaHTMLAttributes<HTMLTextAreaElement> & { wrapperClassName?: string };

export function TextareaField({
  label,
  hint,
  error,
  hideLabel,
  id,
  className,
  wrapperClassName,
  ...props
}: TextareaFieldProps) {
  const ids = useFieldIds(id, props.name);
  return (
    <FieldFrame
      ids={ids}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      className={wrapperClassName}
    >
      <textarea
        id={ids.id}
        className={cn('input min-h-24 py-2.5', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error)}
        {...props}
      />
    </FieldFrame>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectFieldProps = FieldProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
    options: readonly SelectOption[];
    placeholder?: string;
    wrapperClassName?: string;
  };

export function SelectField({
  label,
  hint,
  error,
  hideLabel,
  id,
  className,
  wrapperClassName,
  options,
  placeholder,
  ...props
}: SelectFieldProps) {
  const ids = useFieldIds(id, props.name);
  return (
    <FieldFrame
      ids={ids}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      className={wrapperClassName}
    >
      <select
        id={ids.id}
        className={cn('input', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error)}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ label, description, id, className, ...props }: CheckboxProps) {
  const ids = useFieldIds(
    id,
    props.name ? `${props.name}-${String(props.value ?? '')}` : undefined,
  );
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input
        id={ids.id}
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-brand"
        aria-describedby={description ? ids.hintId : undefined}
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={ids.id} className="text-sm font-medium">
          {label}
        </label>
        {description && (
          <p id={ids.hintId} className="text-sm text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/** Form-level error or success message, announced to screen readers. */
export function FormMessage({
  error,
  success,
}: {
  error?: string | undefined;
  success?: string | undefined;
}) {
  if (error)
    return (
      <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-ink">
        {error}
      </p>
    );
  if (success)
    return (
      <p role="status" className="rounded-xl bg-success-soft px-4 py-3 text-sm text-ink">
        {success}
      </p>
    );
  return null;
}

// ----------------------------------------------------------------- layout

export function Card({ className, ...props }: ComponentPropsWithoutRef<'section'>) {
  return <section className={cn('card', className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-semibold tracking-widest text-muted uppercase">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-3 text-lg font-semibold">
      {children}
    </h2>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-prose text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink',
  brand: 'bg-brand-soft text-ink',
  success: 'bg-success-soft text-ink',
  warning: 'bg-warning-soft text-ink',
  danger: 'bg-danger-soft text-ink',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
}) {
  const urgent = tone === 'danger' || tone === 'warning';
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cn('rounded-xl px-4 py-3 text-sm', BADGE_TONES[tone])}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

/** A key figure for dashboards and reports. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="card">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------- data table

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Hide on narrow screens (still available to screen readers via the row's other cells). */
  hideOnMobile?: boolean;
  /** Use this column as the row header (<th scope="row">). */
  rowHeader?: boolean;
}

export interface DataTableProps<T> {
  caption: ReactNode;
  /** Visually hide the caption (screen readers still announce it). */
  hideCaption?: boolean;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
}

/**
 * Accessible, responsive table: a real <table> with caption and scoped
 * headers, scrolling inside its own container on small screens.
 */
export function DataTable<T>({
  caption,
  hideCaption,
  columns,
  rows,
  rowKey,
  empty,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  // `relative` keeps absolutely positioned sr-only text inside the scroll box, so wide tables never widen the page.
  return (
    <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full border-collapse text-left text-sm">
        <caption className={hideCaption ? 'sr-only' : 'px-4 pt-4 text-left font-semibold'}>
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-4 py-3 font-semibold whitespace-nowrap text-muted',
                  c.align === 'right' && 'text-right',
                  c.hideOnMobile && 'hidden sm:table-cell',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-line last:border-0">
              {columns.map((c) =>
                createElement(
                  c.rowHeader ? 'th' : 'td',
                  {
                    key: c.key,
                    scope: c.rowHeader ? 'row' : undefined,
                    className: cn(
                      'px-4 py-3 align-top',
                      c.rowHeader && 'font-medium',
                      c.align === 'right' && 'text-right tabular-nums',
                      c.hideOnMobile && 'hidden sm:table-cell',
                    ),
                  },
                  c.cell(row),
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------- formatting

export function Money({
  minor,
  tenant,
}: {
  minor: number;
  tenant?: Pick<TenantLocale, 'currency' | 'locale'>;
}) {
  return <span className="tabular-nums">{formatMoney(minor, tenant)}</span>;
}

export function DateTime({
  value,
  tenant,
  dateOnly,
}: {
  value: string | Date;
  tenant?: Pick<TenantLocale, 'locale' | 'timezone'>;
  dateOnly?: boolean;
}) {
  const iso = new Date(value).toISOString();
  return (
    <time dateTime={iso}>
      {dateOnly ? formatDate(value, tenant) : formatDateTime(value, tenant)}
    </time>
  );
}

// ------------------------------------------------------------------ shell

export function SkipLink({ href = '#main' }: { href?: string }) {
  return (
    <a
      href={href}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-ink focus:px-4 focus:py-2 focus:text-bg"
    >
      Skip to content
    </a>
  );
}

/**
 * Responsive app frame: a top bar (brand, actions) with navigation below it.
 * Navigation scrolls sideways on phones rather than hiding behind a menu.
 */
export function AppShell({
  brand,
  actions,
  nav,
  children,
}: {
  brand: ReactNode;
  actions?: ReactNode;
  nav?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3 sm:px-6">
          <div className="min-w-0">{brand}</div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          {nav ? <div className="w-full">{nav}</div> : <div className="h-3 w-full" />}
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </>
  );
}

/** Centred single-column layout for sign-in, onboarding and similar pages. */
export function CenteredPage({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      {children}
    </main>
  );
}
