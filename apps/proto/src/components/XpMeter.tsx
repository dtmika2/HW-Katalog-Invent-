/**
 * The XP meter next to the bell: title, a thin bar to the next level, and the only place where new
 * points are announced (a line under the meter, in the page flow, never over content).
 */
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { cs } from '../i18n/cs';
import { badgeLines, pointsLine, titleOf } from '../lib/gamification';
import { useAppState } from '../store';
import {
  badgeKeys,
  useDisplayOff,
  useGamificationStore,
  useMyProgress,
  useTitleForm,
} from '../store/gamification';

/** How long the points line stays before it fades. */
const SHOW_MS = 8000;
const FADE_MS = 700;

export function XpMeter() {
  const s = useAppState();
  const p = useMyProgress();
  const put = useGamificationStore((x) => x.put);
  const off = useDisplayOff(p.userId);
  const form = useTitleForm(p.userId);
  const [lines, setLines] = useState<string[]>([]);
  const [fading, setFading] = useState(false);

  // Announce what is new since the last announcement, once, then remember it.
  useEffect(() => {
    const seen = p.seen;
    if (!seen || off) return;
    const announced = new Set(seen.announced);
    const fresh = p.mine.filter((e) => !announced.has(e.id));
    const newBadges = badgeKeys(p.badges).filter((k) => !seen.badges.includes(k));
    const levelUp = p.level.level > seen.level;
    if (fresh.length === 0 && newBadges.length === 0 && !levelUp) return;
    const next = [
      pointsLine(s, fresh),
      levelUp ? cs.gamification.newLevel(titleOf(p.level, form)) : undefined,
      ...badgeLines(p.badges, newBadges),
    ].filter((x): x is string => !!x);
    setLines(next);
    setFading(false);
    put(p.userId, {
      ...seen,
      announced: [...seen.announced, ...fresh.map((e) => e.id)],
      badges: [...seen.badges, ...newBadges],
      level: Math.max(seen.level, p.level.level),
    });
  }, [p, s, put, off, form]);

  useEffect(() => {
    if (lines.length === 0) return;
    const fade = setTimeout(() => setFading(true), SHOW_MS);
    const gone = setTimeout(() => setLines([]), SHOW_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [lines]);

  const viewed = new Set(p.seen?.viewed ?? p.mine.map((e) => e.id));
  const pending = p.mine.filter((e) => !viewed.has(e.id)).reduce((n, e) => n + e.points, 0);
  const title = titleOf(p.level, form);
  const pct = Math.round(p.level.progress * 100);
  if (off) return null;

  return (
    <div data-testid="xp" className="flex w-full shrink-0 flex-col items-end sm:w-52">
      <NavLink
        to="/profil"
        aria-label={cs.gamification.meterLabel(title, pending)}
        title={cs.gamification.meterHint(p.level.level, p.total, p.level.nextAt)}
        className="flex h-9 w-full flex-col justify-center gap-1 rounded border border-alu-line bg-white px-2 hover:bg-alu"
      >
        <span className="flex items-baseline justify-between gap-2 text-xs leading-none">
          <span data-testid="xp-title" className="truncate font-cond font-bold text-ink">
            {title}
          </span>
          {pending > 0 && (
            <span
              data-testid="xp-pending"
              title={cs.gamification.pendingHint}
              className="shrink-0 font-semibold text-tape-dark"
            >
              {cs.gamification.plusXp(pending)}
            </span>
          )}
        </span>
        <span
          role="progressbar"
          aria-label={cs.gamification.level(p.level.level)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="block h-1.5 w-full overflow-hidden rounded-full bg-alu"
        >
          <span className="block h-full rounded-full bg-tape" style={{ width: `${pct}%` }} />
        </span>
      </NavLink>
      <p
        data-testid="xp-line"
        aria-live="polite"
        className={`mt-1 w-full text-right sm:w-56 text-xs leading-snug text-ink-soft transition-opacity duration-700 ${fading ? 'opacity-0' : 'opacity-100'}`}
      >
        {lines.map((l) => (
          <span key={l} className="block">
            {l}
          </span>
        ))}
      </p>
    </div>
  );
}
