import { Link } from 'react-router-dom';
import { categoryPath, type AppState } from '@quix/core';
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

/** "Kabeláž › Napájecí kabely" label; each part links into the category view. */
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
  return (
    <span
      data-testid="category-label"
      className="inline-flex items-center gap-1 rounded-full border border-alu-line bg-alu/70 px-2 py-0.5 text-[11px] text-ink-soft"
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
