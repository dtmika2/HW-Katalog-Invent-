/**
 * Gamification calibration (G3): the ledger over a state, per person, per role and per rule,
 * checked against the balance targets in `docs/gamification-plan.md`. Printed by
 * `npm run xp-report`; the per-role figures are pinned by a snapshot test.
 *
 * The demo history has hardly any messages, notes or files, so the communication target is
 * checked on a "talkative team" variant (`withTypicalTalk`), not on the bare demo.
 */
import {
  addDays,
  computeLedger,
  diffDays,
  type ActivityCategory,
  type AppState,
  type Attachment,
  type Booking,
  type IsoDate,
  type LedgerEntry,
  type Message,
  type Role,
  type RuleId,
} from '@quix/core';

/** Targets (see the plan, G3). */
export const TARGETS = {
  /** Per-person monthly XP of each role within ±25 % of the average of the roles. */
  roleSpread: 0.25,
  /** No single rule above this share of a person's XP. */
  maxRuleShare: 0.3,
  /** Communication below this share of a person's XP, also for a talkative team. */
  maxTalkShare: 0.15,
} as const;

/**
 * Each role's main job in the system, allowed above `maxRuleShare`: the Chief approves and the
 * PM requests. Neither can be inflated unseen: every approval needs a PM's request, and every
 * request goes to the Chief.
 */
export const CORE_RULES: readonly RuleId[] = ['chief.approved', 'booking.submitted'];

/** Roles that do the daily work (the admin only sets the system up). */
const WORK_ROLES: Role[] = ['pm', 'chief', 'warehouse'];

/** People below this many points are too inactive in the demo to judge shares. */
const ACTIVE_MIN = 100;

export interface PersonReport {
  userId: string;
  name: string;
  role: Role;
  total: number;
  byCategory: Partial<Record<ActivityCategory, number>>;
  /** Largest rule other than the role's core rule. */
  topRule: { ruleId: string; share: number };
  talkShare: number;
}

export interface RoleReport {
  role: Role;
  /** People of the role with any points (an unused account does not lower its role). */
  people: number;
  total: number;
  perPersonMonth: number;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface XpReport {
  months: number;
  people: PersonReport[];
  roles: RoleReport[];
  rules: { ruleId: RuleId; points: number; share: number }[];
}

export interface Calibration {
  demo: XpReport;
  /** The demo with a talkative team (`withTypicalTalk`). */
  talkative: XpReport;
  checks: Check[];
}

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
const pct = (x: number) => `${(x * 100).toFixed(0)} %`;

export function xpReport(state: AppState, ledger: LedgerEntry[] = computeLedger(state)): XpReport {
  const days = ledger.length ? diffDays(ledger[0]!.on, ledger[ledger.length - 1]!.on) + 1 : 1;
  const months = Math.max(1, days / 30.4);
  const all = ledger.reduce((n, e) => n + e.points, 0);

  const people: PersonReport[] = state.users
    .filter((u) => WORK_ROLES.includes(u.role))
    .map((u) => {
      const mine = ledger.filter((e) => e.userId === u.id);
      const total = mine.reduce((n, e) => n + e.points, 0);
      const byCategory: PersonReport['byCategory'] = {};
      const byRule = new Map<RuleId, number>();
      for (const e of mine) {
        byCategory[e.category] = (byCategory[e.category] ?? 0) + e.points;
        byRule.set(e.ruleId, (byRule.get(e.ruleId) ?? 0) + e.points);
      }
      const [ruleId, top] = [...byRule]
        .filter(([id]) => !CORE_RULES.includes(id))
        .sort((a, b) => b[1] - a[1])[0] ?? ['—', 0];
      return {
        userId: u.id,
        name: u.name,
        role: u.role,
        total,
        byCategory,
        topRule: { ruleId, share: share(top, total) },
        talkShare: share(byCategory.talk ?? 0, total),
      };
    });

  const roles: RoleReport[] = WORK_ROLES.map((role) => {
    const of = people.filter((p) => p.role === role && p.total > 0);
    const total = of.reduce((n, p) => n + p.total, 0);
    return { role, people: of.length, total, perPersonMonth: share(total, of.length * months) };
  });

  const byRule = new Map<RuleId, number>();
  for (const e of ledger) byRule.set(e.ruleId, (byRule.get(e.ruleId) ?? 0) + e.points);
  const rules = [...byRule]
    .map(([ruleId, points]) => ({ ruleId, points, share: share(points, all) }))
    .sort((a, b) => b.points - a.points);
  return { months, people, roles, rules };
}

/** The demo report, the talkative variant, and the targets checked on them. */
export function calibrate(state: AppState, today: IsoDate): Calibration {
  const demo = xpReport(state);
  const talkative = xpReport(withTypicalTalk(state, today));
  const avg = demo.roles.reduce((n, r) => n + r.perPersonMonth, 0) / demo.roles.length;
  const active = (r: XpReport) => r.people.filter((p) => p.total >= ACTIVE_MIN);
  const checks: Check[] = [
    ...demo.roles.map((r) => {
      const dev = share(r.perPersonMonth - avg, avg);
      return {
        name: `role ${r.role} within ±${pct(TARGETS.roleSpread)} of the average`,
        ok: Math.abs(dev) <= TARGETS.roleSpread,
        detail: `${r.perPersonMonth.toFixed(0)} XP/person/month vs ${avg.toFixed(0)} (${pct(dev)})`,
      };
    }),
    ...active(demo).map((p) => ({
      name: `${p.name}: no rule above ${pct(TARGETS.maxRuleShare)}`,
      ok: p.topRule.share <= TARGETS.maxRuleShare,
      detail: `${p.topRule.ruleId} ${pct(p.topRule.share)}`,
    })),
    ...active(talkative).map((p) => ({
      name: `${p.name}: communication below ${pct(TARGETS.maxTalkShare)} (talkative team)`,
      ok: p.talkShare < TARGETS.maxTalkShare,
      detail: pct(p.talkShare),
    })),
  ];
  return { demo, talkative, checks };
}

/**
 * The demo plus the communication of a talkative team: on every booking, while it is open, its PM
 * writes every 4 days and the Chief answers the next day; the PM adds one note; whoever does a
 * vratka adds a photo that day. More than a real team writes, so the target holds with margin.
 */
export function withTypicalTalk(state: AppState, today: IsoDate): AppState {
  const chief = state.users.find((u) => u.role === 'chief');
  const messages: Message[] = [...state.messages];
  const attachments: Attachment[] = [...state.attachments];
  let n = 0;
  const say = (bookingId: string, authorId: string, on: IsoDate, text: string) =>
    messages.push({ id: `msg-cal-${++n}`, bookingId, authorId, on, text });
  const attach = (a: Omit<Attachment, 'id'>) => attachments.push({ id: `att-cal-${++n}`, ...a });

  for (const b of state.bookings) {
    const end = openUntil(b, today);
    attach({
      bookingId: b.id,
      by: b.pmId,
      on: addDays(b.createdAt, 1),
      text: 'Kontakt na místě: technik sálu, příjezd zadem',
    });
    for (let d = addDays(b.createdAt, 1); d <= end; d = addDays(d, 4)) {
      say(b.id, b.pmId, d, 'Upřesnění od klienta k rozsahu techniky');
      if (chief && addDays(d, 1) <= end)
        say(b.id, chief.id, addDays(d, 1), 'Beru na vědomí, upravím rezervaci');
    }
  }
  for (const s of state.returnSessions)
    attach({
      bookingId: s.bookingId,
      by: s.userId,
      on: s.on,
      file: { name: 'vratka.jpg', size: 1, key: `cal-${s.id}` },
    });
  messages.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  return { ...state, messages, attachments };
}

/** Last day a booking is being talked about. */
function openUntil(b: Booking, today: IsoDate): IsoDate {
  const lastEvent =
    b.periods
      .map((p) => p.eventTo)
      .sort()
      .at(-1) ?? b.createdAt;
  const end = b.cancelled?.on ?? b.closedOn ?? addDays(lastEvent, 3);
  return end < today ? end : today;
}
