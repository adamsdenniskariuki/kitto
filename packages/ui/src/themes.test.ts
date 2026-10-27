import { describe, expect, it } from 'vitest';
import {
  contrast,
  getTheme,
  parseColorScheme,
  themeCss,
  THEME_KEYS,
  THEMES,
  type Palette,
} from './themes';

// [foreground, background, minimum ratio] pairs actually used by components.
const PAIRS: [keyof Palette, keyof Palette, number][] = [
  ['ink', 'bg', 4.5],
  ['ink', 'surface', 4.5],
  ['ink', 'surface-2', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'surface-2', 4.5],
  ['brand', 'surface', 4.5],
  ['brand', 'bg', 4.5],
  ['brand-ink', 'brand', 4.5],
  ['ink', 'brand-soft', 4.5],
  ['danger', 'surface', 4.5],
  ['danger-ink', 'danger', 4.5],
  ['ink', 'danger-soft', 4.5],
  ['ink', 'success-soft', 4.5],
  ['ink', 'warning-soft', 4.5],
  ['success', 'surface', 4.5],
  ['warning', 'surface', 4.5],
  ['focus', 'surface', 3],
  ['focus', 'bg', 3],
];

describe('themes', () => {
  for (const key of THEME_KEYS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${key}/${mode} meets WCAG AA contrast`, () => {
        const p = THEMES[key][mode];
        const failures = PAIRS.filter(([fg, bg, min]) => contrast(p[fg], p[bg]) < min).map(
          ([fg, bg, min]) => `${fg} on ${bg}: ${contrast(p[fg], p[bg]).toFixed(2)} < ${min}`,
        );
        expect(failures).toEqual([]);
      });
    }
  }

  it('computes known contrast ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('falls back to the default theme', () => {
    expect(getTheme('nope').key).toBe('kitto');
    expect(getTheme(null).key).toBe('kitto');
    expect(getTheme('toString').key).toBe('kitto');
    expect(getTheme('ocean').key).toBe('ocean');
  });

  it('emits light, OS-dark and forced-dark rules', () => {
    const css = themeCss('forest');
    expect(css).toContain(':root{');
    expect(css).toContain('prefers-color-scheme:dark');
    expect(css).toContain(':root[data-theme=dark]');
    expect(css).toContain('--brand:#15803d');
    expect(css).toContain('--brand:#86efac');
  });

  it('parses the colour scheme cookie', () => {
    expect(parseColorScheme('dark')).toBe('dark');
    expect(parseColorScheme('light')).toBe('light');
    expect(parseColorScheme('blue')).toBe('system');
    expect(parseColorScheme(undefined)).toBe('system');
  });
});
