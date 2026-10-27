/**
 * Theme palettes. Every tenant picks a theme (tenants.theme); every theme has
 * light and dark values for the same semantic tokens. <ThemeStyle> turns a
 * theme into CSS variables, and themes.test.ts checks WCAG AA contrast for the
 * pairs the components actually use.
 */

export interface Palette {
  bg: string;
  surface: string;
  'surface-2': string;
  ink: string;
  muted: string;
  line: string;
  brand: string;
  'brand-ink': string;
  'brand-soft': string;
  success: string;
  'success-soft': string;
  warning: string;
  'warning-soft': string;
  danger: string;
  'danger-soft': string;
  'danger-ink': string;
  focus: string;
}

type Neutrals = Omit<Palette, 'brand' | 'brand-ink' | 'brand-soft'>;
type Brand = Pick<Palette, 'brand' | 'brand-ink' | 'brand-soft'>;

const LIGHT: Neutrals = {
  bg: '#f7f7f8',
  surface: '#ffffff',
  'surface-2': '#f0f0f3',
  ink: '#14151a',
  muted: '#5a5d68',
  line: '#dfe0e6',
  success: '#166534',
  'success-soft': '#dcfce7',
  warning: '#92400e',
  'warning-soft': '#fef3c7',
  danger: '#b91c1c',
  'danger-soft': '#fee2e2',
  'danger-ink': '#ffffff',
  focus: '#2563eb',
};

const DARK: Neutrals = {
  bg: '#0f1117',
  surface: '#171a21',
  'surface-2': '#20242d',
  ink: '#f2f3f5',
  muted: '#a2a7b3',
  line: '#2c313c',
  success: '#4ade80',
  'success-soft': '#12301e',
  warning: '#fbbf24',
  'warning-soft': '#3a2a0a',
  danger: '#f87171',
  'danger-soft': '#3b1414',
  'danger-ink': '#0f1117',
  focus: '#93b4ff',
};

export interface Theme {
  key: string;
  name: string;
  light: Palette;
  dark: Palette;
}

function theme(key: string, name: string, light: Brand, dark: Brand): Theme {
  return { key, name, light: { ...LIGHT, ...light }, dark: { ...DARK, ...dark } };
}

export const THEMES = {
  kitto: theme(
    'kitto',
    'Kitto indigo',
    { brand: '#4338ca', 'brand-ink': '#ffffff', 'brand-soft': '#e0e7ff' },
    { brand: '#a5b4fc', 'brand-ink': '#0f1117', 'brand-soft': '#23264a' },
  ),
  ocean: theme(
    'ocean',
    'Ocean',
    { brand: '#0369a1', 'brand-ink': '#ffffff', 'brand-soft': '#e0f2fe' },
    { brand: '#7dd3fc', 'brand-ink': '#0f1117', 'brand-soft': '#0c2a3d' },
  ),
  forest: theme(
    'forest',
    'Forest',
    { brand: '#15803d', 'brand-ink': '#ffffff', 'brand-soft': '#dcfce7' },
    { brand: '#86efac', 'brand-ink': '#0f1117', 'brand-soft': '#12301e' },
  ),
  sunset: theme(
    'sunset',
    'Sunset',
    { brand: '#c2410c', 'brand-ink': '#ffffff', 'brand-soft': '#ffedd5' },
    { brand: '#fdba74', 'brand-ink': '#0f1117', 'brand-soft': '#3b2210' },
  ),
  plum: theme(
    'plum',
    'Plum',
    { brand: '#a21caf', 'brand-ink': '#ffffff', 'brand-soft': '#fae8ff' },
    { brand: '#f0abfc', 'brand-ink': '#0f1117', 'brand-soft': '#3a1440' },
  ),
} as const satisfies Record<string, Theme>;

export type ThemeKey = keyof typeof THEMES;
export const DEFAULT_THEME: ThemeKey = 'kitto';
export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];

export function getTheme(key: string | null | undefined): Theme {
  return key && Object.hasOwn(THEMES, key) ? THEMES[key as ThemeKey] : THEMES[DEFAULT_THEME];
}

/** Colour scheme preference: follow the OS, or force light/dark. Stored in a cookie. */
export type ColorScheme = 'system' | 'light' | 'dark';
export const COLOR_SCHEME_COOKIE = 'kitto_color_scheme';

export function parseColorScheme(value: string | null | undefined): ColorScheme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function vars(p: Palette): string {
  return Object.entries(p)
    .map(([k, v]) => `--${k}:${v}`)
    .join(';');
}

/**
 * CSS for a theme. <html data-theme="light|dark"> forces a scheme; without it
 * the OS preference decides.
 */
export function themeCss(key: string | null | undefined): string {
  const t = getTheme(key);
  return [
    `:root{${vars(t.light)};color-scheme:light}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${vars(t.dark)};color-scheme:dark}}`,
    `:root[data-theme=dark]{${vars(t.dark)};color-scheme:dark}`,
  ].join('\n');
}

// ---------------------------------------------------------------- contrast

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Expected #rrggbb, got ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG 2.x contrast ratio between two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
