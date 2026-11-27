/**
 * Tým: one card per person, sorted by name, with no ranking. The Chief and Admin see the recorded
 * work of the last three months; colleagues see levels and badges (unless switched off).
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ACTIVITY_CATEGORIES,
  activitySummary,
  addMonths,
  badgeProgress,
  endOfMonth,
  levelFor,
  startOfMonth,
  totalPoints,
  type AppState,
  type IsoDate,
  type LedgerEntry,
  type RuleId,
  type User,
} from '@quix/core';
import { BadgeIcon } from '../components/BadgeIcon';
import { cs } from '../i18n/cs';
import { titleOf, type TitleForm } from '../lib/gamification';
import { useAppState, useToday, useUser } from '../store';
import { ledgerOf, useGamificationStore } from '../store/gamification';

const g = cs.gamification;
const t = cs.gamification.team;
const WORK_ROLES: User['role'][] = ['pm', 'chief', 'warehouse'];

function TeamCard({
  s,
  ledger,
  person,
  viewer,
  manager,
  off,
  form,
  today,
}: {
  s: AppState;
  ledger: LedgerEntry[];
  person: User;
  viewer: User;
  manager: boolean;
  off: boolean;
  form: TitleForm;
  today: IsoDate;
}) {
  const mine = ledger.filter((e) => e.userId === person.id);
  const level = levelFor(totalPoints(mine, person.id));
  const earned = badgeProgress(s, ledger, person.id).filter((b) => b.earned > 0);
  const from = startOfMonth(addMonths(today, -2));
  const sum = activitySummary(mine, person.id, from, endOfMonth(today));
  const c = (r: RuleId) => sum.byRule[r]?.count ?? 0;
  const lines = ACTIVITY_CATEGORIES.filter((cat) => sum.byCategory[cat].xp > 0).map((cat) => ({
    cat,
    text: g.activity[cat](c).filter(Boolean).join(', '),
  }));
  const showLevel = manager || !off || person.id === viewer.id;
  return (
    <li className="panel flex flex-col gap-3 p-4" data-testid={`team-card-${person.id}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="font-cond text-lg font-bold leading-tight">
            {person.name}
            {person.id === viewer.id && (
              <span className="ml-1.5 text-xs font-normal text-muted">({t.me})</span>
            )}
          </p>
          <p className="text-xs text-muted">{cs.roles[person.role]}</p>
        </div>
        {showLevel && (
          <p className="shrink-0 text-right">
            <span className="block font-cond font-bold">{titleOf(level, form)}</span>
            <span className="block text-xs text-muted">{g.level(level.level)}</span>
          </p>
        )}
      </div>
      {off && <p className="text-xs text-muted">{manager ? t.hiddenManager : t.hidden}</p>}
      {showLevel && (
        <div>
          <p className="mb-1 text-xs text-muted">{t.badges(earned.length)}</p>
          {earned.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {earned.map((b) => {
                const top = b.steps[b.earned - 1];
                const step = top ? g.steps[top.tier] : '';
                return (
                  <li key={b.id} title={`${g.badges[b.id].name}${step ? ` – ${step}` : ''}`}>
                    <BadgeIcon id={b.id} tier={top?.tier} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {manager && (
        <div data-testid="team-work">
          <p className="mb-1 text-xs font-semibold text-ink-soft">{t.lastMonths}</p>
          <ul className="mb-2 flex gap-3 text-sm">
            {sum.months.map((m) => (
              <li key={m.month} className="tabular-nums">
                <span className="block text-xs text-muted">
                  {cs.gamification.profile.monthLabel(m.month)}
                </span>
                {g.xp(m.xp)}
              </li>
            ))}
          </ul>
          {lines.length === 0 ? (
            <p className="text-xs text-muted">{t.noActivity}</p>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {lines.map((l) => (
                <li key={l.cat}>
                  <span className="font-semibold">{g.categories[l.cat]}:</span> {l.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(manager || !off) && (
        <Link
          to={person.id === viewer.id ? '/profil' : `/profil/${person.id}`}
          className="mt-auto self-start text-sm text-tape-dark underline"
        >
          {manager || person.id === viewer.id ? t.profile : t.colleagueProfile}
        </Link>
      )}
    </li>
  );
}

export function Team() {
  const s = useAppState();
  const viewer = useUser();
  const today = useToday();
  // select the stored object itself: a fresh `{}` per read would re-render forever
  const off = useGamificationStore((p) => p.prefs.off) ?? {};
  const forms = useGamificationStore((p) => p.prefs.form) ?? {};
  const manager = viewer.role === 'chief' || viewer.role === 'admin';
  const ledger = ledgerOf(s);
  const people = useMemo(
    () =>
      s.users
        .filter((u) => u.active && WORK_ROLES.includes(u.role))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs')),
    [s.users],
  );
  return (
    <div className="space-y-4">
      <div>
        <h1>{t.title}</h1>
        <p className="text-sm text-ink-soft">{manager ? t.introManager : t.introColleague}</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="team">
        {people.map((person) => (
          <TeamCard
            key={person.id}
            s={s}
            ledger={ledger}
            person={person}
            viewer={viewer}
            manager={manager}
            off={!!off[person.id]}
            form={forms[person.id] ?? 'm'}
            today={today}
          />
        ))}
      </ul>
      <p className="text-xs text-muted">{g.profile.footnote}</p>
    </div>
  );
}
