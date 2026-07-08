import type { CSSProperties } from 'react';

/**
 * Feedback category colors are user-picked via a free-form color picker
 * (any hex value), so unlike a fixed Tailwind palette, they can't be
 * expressed as static utility classes — Tailwind's build-time scanner only
 * generates CSS for literal class names it can see in source, and an
 * arbitrary user-picked hex is only known at runtime. So color is applied
 * via inline `style` objects computed here; static concerns (layout,
 * spacing, transitions, typography) stay as ordinary Tailwind classes in
 * the consuming components.
 */

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_CATEGORY_COLOR = '#64748b'; // slate-500

// A handful of good-contrast presets shown as quick-pick swatches next to
// the native color input — convenience only, any hex value is valid.
export const FEEDBACK_CATEGORY_PRESETS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
  '#64748b', // slate
];

// Categories created before the color picker existed stored a palette *key*
// (e.g. "orange") instead of a hex value — map those to an equivalent hex
// so old categories keep rendering correctly with no data migration needed.
const LEGACY_KEY_TO_HEX: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', blue: '#3b82f6',
  indigo: '#6366f1', purple: '#a855f7', pink: '#ec4899', slate: '#64748b',
};

/** Normalizes any stored color value (hex or legacy key) to a hex string. */
export function normalizeCategoryColor(color: string | null | undefined): string {
  if (color && HEX_COLOR_RE.test(color)) return color;
  if (color && LEGACY_KEY_TO_HEX[color]) return LEGACY_KEY_TO_HEX[color];
  return DEFAULT_CATEGORY_COLOR;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface CategoryToneStyles {
  /** Small identity dot */
  dotStyle: CSSProperties;
  /** Permanent identity badge — always the same look, not a toggle */
  tagStyle: CSSProperties;
  /** Selected filter pill — solid filled background + shadow, unmistakably "on" */
  chipActiveStyle: CSSProperties;
  /** Count badge on the unselected pill (solid color, white text) */
  badgeStyle: CSSProperties;
}

/**
 * Computes the inline style objects for a given category color. Structural
 * classes (rounded-full, border, px-3, transition, font-semibold, etc.)
 * stay as static Tailwind classes in the component — only color-dependent
 * properties are set here.
 */
export function feedbackCategoryTone(color: string): CategoryToneStyles {
  const hex = normalizeCategoryColor(color);
  return {
    dotStyle: { backgroundColor: hex },
    tagStyle: { backgroundColor: rgba(hex, 0.1), borderColor: rgba(hex, 0.3), color: hex },
    chipActiveStyle: { backgroundColor: hex, borderColor: hex, boxShadow: `0 4px 12px -2px ${rgba(hex, 0.4)}` },
    badgeStyle: { backgroundColor: hex, color: '#ffffff' },
  };
}
