import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { categoryColor, categoryPath, type AppState } from '@quix/core';
import { cs } from '../i18n/cs';

/** Simple line icons for top categories (key stored in `Category.icon`). */
const ICONS: Record<string, string> = {
  speaker: 'M7 3h10v18H7zM12 8.5a1.5 1.5 0 1 0 0 .01M12 17.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3',
  video: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4M9 8v4M12 8v4M15 8v4',
  truss: 'M3 6h18M3 18h18M3 6l4 12 4-12 4 12 4-12 2 6',
  power: 'M13 2 4 14h7l-1 8 9-12h-7z',
  cable: 'M4 4v5a4 4 0 0 0 8 0V7a3 3 0 0 1 6 0v13M2 4h4M16 20h4',
  stage: 'M2 14h20v4H2zM4 18v3M20 18v3M6 10h12l2 4H4z',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
};

export const CATEGORY_ICON_KEYS = Object.keys(ICONS);

/**
 * Tame category colours: a pale fill, a soft border, readable text and a stronger mark for
 * dots and stripes. Deliberately muted so they never compete with the green / amber / red
 * availability badges.
 */
export const CATEGORY_COLORS: Record<
  string,
  { bg: string; border: string; text: string; mark: string }
> = {
  slate: { bg: '#E8ECF1', border: '#C9D2DC', text: '#3D4B5C', mark: '#7D8DA0' },
  stone: { bg: '#EDEAE6', border: '#D6D0C8', text: '#4F4A43', mark: '#9A928A' },
  sand: { bg: '#F5EEDB', border: '#E2D3A8', text: '#66511C', mark: '#BF9F4E' },
  clay: { bg: '#F3E7E0', border: '#DFC7B8', text: '#6A4433', mark: '#B4876D' },
  rose: { bg: '#F5E6E9', border: '#E4C5CC', text: '#6F3B4A', mark: '#BC8492' },
  lavender: { bg: '#ECE8F5', border: '#D1C7E5', text: '#4B3F6E', mark: '#8C7DB5' },
  sky: { bg: '#E2ECF7', border: '#BCD0E9', text: '#2B4E77', mark: '#6E94C2' },
  teal: { bg: '#DFEFEE', border: '#B6D7D5', text: '#215956', mark: '#5E9D99' },
  sage: { bg: '#E4EEE5', border: '#C1D5C3', text: '#30573A', mark: '#719A78' },
  olive: { bg: '#EDEEDD', border: '#D3D6B1', text: '#4C5224', mark: '#9AA05C' },
};

export const CATEGORY_COLOR_KEYS = Object.keys(CATEGORY_COLORS);

/** Palette entry for a category (inherited from the parent), if any. */
export function colorOf(s: AppState, categoryId: string) {
  const key = categoryColor(s, categoryId);
  return key ? CATEGORY_COLORS[key] : undefined;
}

/** Inline styles for a tinted surface of a category. */
export function tint(s: AppState, categoryId: string, strong = false): CSSProperties | undefined {
  const c = colorOf(s, categoryId);
  if (!c) return undefined;
  return strong
    ? { backgroundColor: c.bg, borderColor: c.mark, color: c.text }
    : { backgroundColor: c.bg, borderColor: c.border, color: c.text };
}

export function CategoryIcon({
  icon,
  className = 'h-4 w-4',
}: {
  icon: string | undefined;
  className?: string;
}) {
  const d = icon ? ICONS[icon] : undefined;
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/** A small colour swatch (used in the tree and the category manager). */
export function Swatch({
  color,
  className = 'h-2.5 w-2.5',
}: {
  color: string | undefined;
  className?: string;
}) {
  const c = color ? CATEGORY_COLORS[color] : undefined;
  if (!c)
    return (
      <span
        className={`${className} inline-block rounded-full border border-alu-line`}
        aria-hidden="true"
      />
    );
  return (
    <span
      className={`${className} inline-block shrink-0 rounded-full`}
      style={{ backgroundColor: c.mark }}
      aria-hidden="true"
    />
  );
}

/** "Kabeláž › Napájecí kabely" label in the category's colour; each part links into the category view. */
export function CategoryLabel({
  s,
  categoryId,
  link = true,
}: {
  s: AppState;
  categoryId: string;
  link?: boolean;
}) {
  const path = categoryPath(s, categoryId);
  if (path.length === 0) return null;
  const top = path[0];
  const style = tint(s, categoryId);
  return (
    <span
      data-testid="category-label"
      data-color={categoryColor(s, categoryId) ?? ''}
      className={`inline-flex max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${style ? '' : 'border-alu-line bg-alu/70 text-ink-soft'}`}
      style={style}
    >
      <CategoryIcon icon={top?.icon} className="h-3.5 w-3.5" />
      {path.map((c, i) => (
        <span key={c.id} className="inline-flex items-center gap-1">
          {i > 0 && <span aria-hidden="true">›</span>}
          {link ? (
            <Link
              to={`/catalog?cat=${c.id}`}
              className="hover:underline"
              aria-label={cs.categories.showIn(c.name)}
            >
              {c.name}
            </Link>
          ) : (
            <span>{c.name}</span>
          )}
        </span>
      ))}
    </span>
  );
}
