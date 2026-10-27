'use client';

import { useFormStatus } from 'react-dom';
import { useState, type ReactNode } from 'react';
import { buttonClass, type ButtonVariant } from './components';
import { COLOR_SCHEME_COOKIE, parseColorScheme, type ColorScheme } from './themes';

/** Submit button that disables itself and shows a pending label while its form's action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  size = 'md',
  className,
  name,
  value,
  formAction,
}: {
  children: ReactNode;
  pendingLabel?: ReactNode;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  className?: string;
  name?: string;
  value?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formAction={formAction}
      disabled={pending}
      aria-disabled={pending}
      className={buttonClass(variant, size, className)}
    >
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}

const NEXT: Record<ColorScheme, ColorScheme> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ColorScheme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/**
 * Cycles System -> Light -> Dark. The choice is stored in a cookie so the
 * server renders <html data-theme> correctly on the next request (no flash).
 */
export function ThemeToggle({ initial }: { initial: ColorScheme }) {
  const [scheme, setScheme] = useState<ColorScheme>(parseColorScheme(initial));
  return (
    <button
      type="button"
      className={buttonClass('ghost', 'sm')}
      onClick={() => {
        const next = NEXT[scheme];
        setScheme(next);
        const root = document.documentElement;
        if (next === 'system') root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', next);
        document.cookie = `${COLOR_SCHEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      }}
    >
      <span aria-hidden="true">{scheme === 'dark' ? '☾' : scheme === 'light' ? '☀' : '◐'}</span>
      <span>Theme: {LABEL[scheme]}</span>
    </button>
  );
}

/** A submit button that asks for confirmation first (for destructive actions). */
export function ConfirmSubmit({
  children,
  message,
  variant = 'danger',
  size = 'sm',
}: {
  children: ReactNode;
  message: string;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant, size)}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
