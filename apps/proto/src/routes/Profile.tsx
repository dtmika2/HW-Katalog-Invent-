/**
 * Profile: level and title, badges, activity by period and month, "Proč mám body" (every point with
 * its reason), the printable overview for management, and how points are counted.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ACTIVITY_CATEGORIES,
  activitySummary,
  addMonths,
  canSeeBooking,
  endOfMonth,
  levelHistory,
  POOLS,
  RULE_IDS,
  RULES,
  startOfMonth,
  type ActivitySummary,
  type AppState,
  type BadgeProgress,
  type IsoDate,
  type LedgerEntry,
  type RuleDef,
  type RuleId,
  type User,
} from '@quix/core';
import { BadgeIcon } from '../components/BadgeIcon';
import { DateInput } from '../components/DateInput';
import { Bar, Paper, PrintButton, usePrintTitle } from '../components/print';
import { Empty, Section } from '../components/ui';
import { cs, fmtDate } from '../i18n/cs';
import {
  groupEntries,
  historyRows,
  isBonus,
  rulePointsText,
  titleOf,
  type EntryGroup,
  type HistoryRow as HistoryRowData,
} from '../lib/gamification';
import { useAppState, useToday, useUser } from '../store';
import { useGamificationStore, useMyProgress, type MyProgress } from '../store/gamification';

const g = cs.gamification;
const pf = cs.gamification.profile;
const HISTORY_PAGE = 25;

/** "12 vratek, z toho 8 včas" per category with any points. */
function activityLines(sum: ActivitySummary) {
  const c = (r: RuleId) => sum.byRule[r]?.count ?? 0;
  return ACTIVITY_CATEGORIES.filter((cat) => sum.byCategory[cat].xp > 0).map((cat) => ({
    cat,
    text: g.activity[cat](c).filter(Boolean).join(', '),
    xp: sum.byCategory[cat].xp,
  }));
}

function LevelHeader({ user, p, today }: { user: User; p: MyProgress; today: IsoDate }) {
  const month = activitySummary(p.mine, p.userId, startOfMonth(today), endOfMonth(today));
  const since = levelHistory(p.mine, p.userId).at(-1)?.on;
  const pct = Math.round(p.level.progress * 100);
  return (
    <section className="panel p-4" data-testid="profile-level">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <h1>{user.name}</h1>
          <p className="text-sm text-muted">{cs.roles[user.role]}</p>
        </div>
        <div className="text-right">
          <p className="font-cond text-2xl font-bold">{titleOf(p.level)}</p>
          <p className="text-sm text-muted">
            {g.level(p.level.level)}
            {since && ` · ${pf.levelSince(since)}`}
          </p>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={g.level(p.level.level)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-alu"
      >
        <div className="h-full rounded-full bg-tape" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 flex flex-wrap justify-between gap-x-4 text-sm text-ink-soft">
        <span>{pf.total(p.total)}</span>
        <span>{pf.toNext(p.level.nextAt - p.total)}</span>
        <span>{pf.thisMonth(month.xp)}</span>
      </p>
    </section>
  );
}

function BadgeCard({ b }: { b: BadgeProgress }) {
  const top = b.steps[b.earned - 1];
  const next = b.next;
  const name = g.badges[b.id];
  return (
    <li
      data-testid={`badge-${b.id}`}
      data-earned={b.earned}
      className={`flex gap-3 rounded border border-alu-line p-3 ${b.earned ? 'bg-white' : 'bg-alu/40'}`}
    >
      <BadgeIcon id={b.id} tier={top?.tier} />
      <div className="min-w-0 flex-1">
        <p className={`font-semibold ${b.earned ? 'text-ink' : 'text-muted'}`}>
          {name.name}
          {top && g.steps[top.tier] && (
            <span className="ml-1.5 text-xs font-normal text-muted">{g.steps[top.tier]}</span>
          )}
        </p>
        <p className="text-xs text-muted">{name.how}</p>
        {top?.earnedOn && <p className="mt-1 text-xs text-ink-soft">{pf.earnedOn(top.earnedOn)}</p>}
        {next !== undefined ? (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-alu">
              <span
                className="block h-full rounded-full bg-ink-soft"
                style={{ width: `${Math.min(100, (b.count / next) * 100)}%` }}
              />
            </span>
            <span className="shrink-0 text-xs tabular-nums text-ink-soft">
              {pf.progress(b.count, next)}
            </span>
          </div>
        ) : (
          b.steps.length > 1 && <p className="mt-1 text-xs text-ink-soft">{pf.allSteps}</p>
        )}
      </div>
    </li>
  );
}

function Badges({ badges }: { badges: BadgeProgress[] }) {
  // Earned and started badges first; the rest (often another role's work) folded away.
  const shown = badges.filter((b) => b.earned > 0 || b.count > 0);
  const rest = badges.filter((b) => b.earned === 0 && b.count === 0);
  shown.sort((a, b) => Number(b.earned > 0) - Number(a.earned > 0));
  return (
    <Section title={pf.badges}>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((b) => (
          <BadgeCard key={b.id} b={b} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="mt-3" data-testid="more-badges">
          <summary className="cursor-pointer text-sm font-medium text-ink-soft">
            {pf.moreBadges(rest.length)}
          </summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((b) => (
              <BadgeCard key={b.id} b={b} />
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

/** XP per month as thin horizontal bars; the numbers are written beside them. */
function MonthBars({ p, today }: { p: MyProgress; today: IsoDate }) {
  const from = startOfMonth(addMonths(today, -11));
  const months = activitySummary(p.mine, p.userId, from, endOfMonth(today)).months;
  const first = months.findIndex((m) => m.xp > 0);
  const shown = (first < 0 ? [] : months.slice(first)).reverse();
  const max = Math.max(1, ...shown.map((m) => m.xp));
  if (shown.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-semibold">{pf.monthsTitle}</h3>
      <ul className="space-y-1.5" data-testid="month-bars">
        {shown.map((m) => (
          <li
            key={m.month}
            className="flex items-center gap-2 text-xs"
            title={pf.monthBar(pf.monthLabel(m.month), m.xp)}
          >
            <span className="w-16 shrink-0 tabular-nums text-ink-soft">
              {pf.monthLabel(m.month)}
            </span>
            <span className="flex h-3 flex-1 items-center">
              <span
                className="block h-3 rounded-r bg-tape"
                style={{ width: `${(m.xp / max) * 100}%`, minWidth: m.xp > 0 ? 2 : 0 }}
              />
            </span>
            <span className="w-14 shrink-0 text-right tabular-nums text-ink">{g.xp(m.xp)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Activity({ p, today }: { p: MyProgress; today: IsoDate }) {
  const thisMonth = today.slice(0, 7);
  const [period, setPeriod] = useState<string>(thisMonth);
  const options = useMemo(() => {
    const out: string[] = [];
    const start = p.mine[0]?.on ?? today;
    for (let m = startOfMonth(today); m >= startOfMonth(start); m = addMonths(m, -1))
      out.push(m.slice(0, 7));
    return out;
  }, [p.mine, today]);
  const sum =
    period === 'all'
      ? activitySummary(p.mine, p.userId)
      : activitySummary(p.mine, p.userId, `${period}-01`, endOfMonth(`${period}-01`));
  const lines = activityLines(sum);
  return (
    <Section
      title={pf.activity}
      actions={
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">{pf.period}</span>
          <select
            className="input w-auto"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {options.map((m) => (
              <option key={m} value={m}>
                {m === thisMonth ? pf.periodMonth : pf.monthLabel(m)}
              </option>
            ))}
            <option value="all">{pf.periodAll}</option>
          </select>
        </label>
      }
    >
      {lines.length === 0 ? (
        <Empty>{pf.noActivity}</Empty>
      ) : (
        <table className="w-full text-sm" data-testid="activity">
          <tbody>
            {lines.map((l) => (
              <tr key={l.cat} className="border-b border-alu last:border-0">
                <th scope="row" className="w-32 py-1.5 pr-3 text-left font-semibold">
                  {g.categories[l.cat]}
                </th>
                <td className="py-1.5 pr-3 text-ink-soft">{l.text}</td>
                <td className="py-1.5 text-right tabular-nums">{g.xp(l.xp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <MonthBars p={p} today={today} />
    </Section>
  );
}

function EventLink({ s, user, bookingId }: { s: AppState; user: User; bookingId?: string }) {
  const b = bookingId ? s.bookings.find((x) => x.id === bookingId) : undefined;
  if (!b) return null;
  return (
    <>
      {' – '}
      {canSeeBooking(user, b) ? (
        <Link to={`/bookings/${b.id}`} className="text-tape-dark underline">
          {b.eventName}
        </Link>
      ) : (
        b.eventName
      )}
    </>
  );
}

function HistoryItem({
  s,
  user,
  row,
  unviewed,
}: {
  s: AppState;
  user: User;
  row: HistoryRowData;
  unviewed: ReadonlySet<string>;
}) {
  const gr = row.groups[0] as EntryGroup;
  const n = row.groups.length;
  const isNew = row.groups.some((x) => [x.root, ...x.bonuses].some((e) => unviewed.has(e.id)));
  const rootBonus = isBonus(gr.root);
  return (
    <li className="border-b border-alu py-2 last:border-0" data-testid="history-row">
      <div className="flex items-baseline gap-3 text-sm">
        <span className="w-20 shrink-0 tabular-nums text-muted">{fmtDate(gr.root.on)}</span>
        <span className="min-w-0 flex-1">
          <span className={rootBonus ? 'text-ink-soft' : 'font-medium'}>
            {g.rules[gr.root.ruleId].label}
            {n > 1 && ` ${pf.times(n)}`}
          </span>
          {rootBonus && <span className="ml-1 text-xs text-muted">({g.bonusMark})</span>}
          <EventLink s={s} user={user} bookingId={gr.root.bookingId} />
          {isNew && (
            <span className="ml-2 rounded bg-tape-light px-1.5 text-xs font-semibold text-tape-dark">
              {pf.newMark}
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums font-semibold" data-testid="history-points">
          {g.plusXp(n > 1 ? row.points : gr.root.points)}
        </span>
      </div>
      {gr.bonuses.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-[5.75rem]">
          {gr.bonuses.map((b) => (
            <li key={b.id} className="flex justify-between gap-3 text-xs text-ink-soft">
              <span>{g.rules[b.ruleId].label}</span>
              <span className="tabular-nums" data-testid="history-points">
                {g.plusXp(b.points)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function History({ p, unviewed }: { p: MyProgress; unviewed: ReadonlySet<string> }) {
  const s = useAppState();
  const user = useUser();
  const [shown, setShown] = useState(HISTORY_PAGE);
  const groups = useMemo(() => historyRows(groupEntries(p.mine).reverse()), [p.mine]);
  return (
    <Section title={pf.history}>
      {groups.length === 0 ? (
        <Empty>{pf.historyEmpty}</Empty>
      ) : (
        <>
          <ul data-testid="history">
            {groups.slice(0, shown).map((row) => (
              <HistoryItem
                key={row.groups[0]?.root.id}
                s={s}
                user={user}
                row={row}
                unviewed={unviewed}
              />
            ))}
          </ul>
          {shown < groups.length && (
            <button
              type="button"
              className="btn btn-sm mt-2"
              onClick={() => setShown(shown + HISTORY_PAGE)}
            >
              {pf.more}
            </button>
          )}
        </>
      )}
    </Section>
  );
}

function OverviewPaper({
  user,
  p,
  from,
  to,
}: {
  user: User;
  p: MyProgress;
  from: IsoDate;
  to: IsoDate;
}) {
  usePrintTitle(pf.overviewFile(user.name, from, to));
  const sum = activitySummary(p.mine, p.userId, from, to);
  const lines = activityLines(sum);
  const care = RULE_IDS.filter(
    (r) => (RULES[r] as RuleDef).bonus && (sum.byRule[r]?.count ?? 0) > 0,
  );
  const badges = p.badges.flatMap((b) =>
    b.steps.flatMap((st) =>
      st.earnedOn && st.earnedOn >= from && st.earnedOn <= to
        ? [`${g.badges[b.id].name}${g.steps[st.tier] ? ` – ${g.steps[st.tier]}` : ''}`]
        : [],
    ),
  );
  return (
    <Paper testId="overview-paper">
      <header className="mb-3 border-b-2 border-black pb-2">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-cond text-[18pt] font-bold leading-tight">{user.name}</p>
          <p className="shrink-0 text-[9pt]">{pf.overviewDoc}</p>
        </div>
        <p className="text-[10pt]">
          {cs.roles[user.role]} · {pf.overviewLevel(titleOf(p.level), p.level.level)}
        </p>
        <p className="font-cond text-[13pt] font-bold">{pf.overviewPeriod(from, to)}</p>
        <p className="text-[10pt]">{pf.overviewXp(sum.xp)}</p>
      </header>
      {lines.length === 0 ? (
        <p>{pf.noActivity}</p>
      ) : (
        <table className="mb-4 w-full border-collapse text-[10pt]">
          <tbody>
            {lines.map((l) => (
              <tr key={l.cat} className="border-b border-neutral-300">
                <th scope="row" className="w-32 py-1 pr-3 text-left">
                  {g.categories[l.cat]}
                </th>
                <td className="py-1 pr-3">{l.text}</td>
                <td className="py-1 text-right">{g.xp(l.xp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Bar>{pf.overviewCare}</Bar>
      <p className="mb-3 mt-1">
        {care.length
          ? care.map((r) => `${g.rules[r].label}: ${sum.byRule[r]?.count ?? 0}×`).join(' · ')
          : pf.overviewNone}
      </p>
      <Bar>{pf.overviewBadges}</Bar>
      <p className="mb-6 mt-1">{badges.length ? badges.join(' · ') : pf.overviewNone}</p>
      <p className="text-[8.5pt] italic">{pf.footnote}</p>
    </Paper>
  );
}

function Overview({ user, p, today }: { user: User; p: MyProgress; today: IsoDate }) {
  const [from, setFrom] = useState(startOfMonth(today));
  const [to, setTo] = useState(today);
  return (
    <>
      <div className="print:hidden">
        <Section title={pf.overview} actions={<PrintButton disabled={!from || !to || from > to} />}>
          <p className="mb-3 text-sm text-ink-soft">{pf.overviewHint}</p>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="label" htmlFor="ov-from">
                {cs.common.from}
              </label>
              <DateInput id="ov-from" narrow value={from} onChange={setFrom} />
            </div>
            <div>
              <label className="label" htmlFor="ov-to">
                {cs.common.to}
              </label>
              <DateInput id="ov-to" narrow value={to} onChange={setTo} />
            </div>
          </div>
        </Section>
      </div>
      {from && to && from <= to && <OverviewPaper user={user} p={p} from={from} to={to} />}
    </>
  );
}

function HowPoints() {
  return (
    <details className="panel p-4" data-testid="how-points">
      <summary className="cursor-pointer font-cond text-lg font-bold">{pf.how}</summary>
      <p className="mt-2 text-sm text-ink-soft">{pf.howIntro}</p>
      {ACTIVITY_CATEGORIES.map((cat) => {
        const rules = RULE_IDS.filter((r) => RULES[r].category === cat);
        return (
          <div key={cat} className="mt-4">
            <h3 className="mb-1 text-sm font-semibold">{g.categories[cat]}</h3>
            <table className="w-full text-sm">
              <tbody>
                {rules.map((r) => {
                  const def = RULES[r] as RuleDef;
                  const notes = [
                    def.bonus ? g.bonusMark : '',
                    def.caps?.perSubject ? g.capSubject(def.caps.perSubject) : '',
                    def.pool ? g.pool(POOLS[def.pool].perWeek) : '',
                  ].filter(Boolean);
                  return (
                    <tr key={r} className="border-b border-alu last:border-0" data-rule={r}>
                      <td className="py-1 pr-3 align-top">
                        <span className="font-medium">{g.rules[r].label}</span>
                        <span className="block text-xs text-muted">{g.rules[r].how}</span>
                      </td>
                      <td className="w-64 py-1 text-right align-top tabular-nums">
                        {rulePointsText(def, g.units[r])}
                        {notes.length > 0 && (
                          <span className="block text-xs text-muted">{notes.join(', ')}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </details>
  );
}

export function Profile() {
  const user = useUser();
  const today = useToday();
  const p = useMyProgress();
  const put = useGamificationStore((x) => x.put);
  // What was new when the page opened stays marked during this visit.
  const [unviewed] = useState<ReadonlySet<string>>(() => {
    const viewed = new Set(p.seen?.viewed ?? p.mine.map((e: LedgerEntry) => e.id));
    return new Set(p.mine.filter((e) => !viewed.has(e.id)).map((e) => e.id));
  });
  useEffect(() => {
    const seen = p.seen;
    if (!seen) return;
    const viewed = new Set(seen.viewed);
    if (p.mine.every((e) => viewed.has(e.id))) return;
    put(p.userId, { ...seen, viewed: p.mine.map((e) => e.id) });
  }, [p, put]);

  return (
    <div className="space-y-4">
      <div className="space-y-4 print:hidden">
        <LevelHeader user={user} p={p} today={today} />
        <Badges badges={p.badges} />
        <Activity p={p} today={today} />
        <History p={p} unviewed={unviewed} />
      </div>
      <Overview user={user} p={p} today={today} />
      <div className="space-y-4 print:hidden">
        <HowPoints />
        <p className="text-xs text-muted">{pf.footnote}</p>
      </div>
    </div>
  );
}
