import { describe, expect, it } from 'vitest';
import {
  addDays,
  badgeProgress,
  BADGES,
  RULES,
  type AppState,
  type BadgeId,
  type LedgerEntry,
  type RuleId,
} from '../../src';
import { baseState, item, ln, order, U, W, withBookings } from '../helpers';
import { msg, withMessages } from './helpers';

const ME = U.martin.id;
let n = 0;
const e = (ruleId: RuleId, on: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `${ruleId}:${++n}`,
  userId: ME,
  on,
  ruleId,
  points: 1,
  category: RULES[ruleId].category,
  params: {},
  ...extra,
});
/** `count` entries of a rule on consecutive days from 2027-01-01. */
const many = (ruleId: RuleId, count: number) =>
  Array.from({ length: count }, (_, i) => e(ruleId, addDays('2027-01-01', i)));

const badge = (ledger: LedgerEntry[], id: BadgeId, state: AppState = baseState()) =>
  badgeProgress(state, ledger, ME).find((b) => b.id === id)!;

describe('gamification: badges', () => {
  it('every badge has one step or bronze / silver / gold with growing thresholds', () => {
    for (const b of BADGES) {
      expect([1, 3]).toContain(b.steps.length);
      for (let i = 1; i < b.steps.length; i++) expect(b.steps[i]!).toBeGreaterThan(b.steps[i - 1]!);
    }
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });

  it('a step is earned on the day of its N-th occurrence; progress shows what comes next', () => {
    const b = badge(many('pack.refilled', 7), 'fullCase');
    expect(b.count).toBe(7);
    expect(b.earned).toBe(1);
    expect(b.steps[0]).toEqual({ threshold: 5, tier: 'bronze', earnedOn: '2027-01-05' });
    expect(b.steps[1]).toEqual({ threshold: 25, tier: 'silver' });
    expect(b.next).toBe(25);
  });

  it('all three steps earned leaves nothing next', () => {
    const b = badge(many('ship.transfer', 50), 'bridge');
    expect(b.steps.map((s) => s.tier)).toEqual(['bronze', 'silver', 'gold']);
    expect(b.earned).toBe(3);
    expect(b.next).toBeUndefined();
  });

  it('only the person’s own entries count', () => {
    const others = many('pack.refilled', 10).map((x) => ({ ...x, userId: U.karel.id }));
    expect(badge(others, 'fullCase').count).toBe(0);
  });

  it('První krok: first packing, vratka, request, report and decision are one-off badges', () => {
    const cases: [BadgeId, RuleId][] = [
      ['first.packing', 'pack.packed'],
      ['first.vratka', 'vratka.session'],
      ['first.request', 'booking.submitted'],
      ['first.report', 'report.fault'],
      ['first.decision', 'chief.approved'],
      ['first.decision', 'chief.returned'],
    ];
    for (const [id, rule] of cases) {
      const b = badge([e(rule, '2027-02-03')], id);
      expect(b.steps).toEqual([{ threshold: 1, tier: 'single', earnedOn: '2027-02-03' }]);
    }
  });

  it('Pečlivá vratka: on time and with at least one voluntary bonus', () => {
    const vratka = (on: string, bonuses: RuleId[]) => {
      const s = e('vratka.session', on);
      return [s, ...bonuses.map((r) => e(r, on, { parentId: s.id }))];
    };
    const ledger = [
      ...vratka('2027-03-01', ['vratka.onTime', 'vratka.photo']),
      ...vratka('2027-03-02', ['vratka.onTime']),
      ...vratka('2027-03-03', ['vratka.extraNote']),
      ...vratka('2027-03-04', ['vratka.onTime', 'vratka.damageDescribed']),
    ];
    expect(badge(ledger, 'carefulVratka').count).toBe(2);
  });

  it('counting badges follow their rules', () => {
    const cases: [BadgeId, RuleId[], number][] = [
      ['completeCases', ['pack.caseChecked'], 25],
      ['ahead', ['booking.early', 'booking.veryEarly'], 5],
      ['firstTime', ['booking.firstTime'], 5],
      ['sharpEye', ['report.confirmed'], 3],
      ['workshop', ['service.fixed'], 5],
      ['solver', ['chief.conflictResolved', 'booking.shortageSolved'], 5],
      ['bridge', ['ship.transfer'], 3],
      ['loansOnTime', ['loan.returnedOnTime'], 5],
    ];
    for (const [id, rules, bronze] of cases) {
      const ledger = rules.flatMap((r) => many(r, Math.ceil(bronze / rules.length)));
      const b = badge(ledger, id);
      expect(b.steps[0]?.threshold).toBe(bronze);
      expect(b.earned).toBe(1);
    }
  });

  it('Kronika: bookings with one’s own message, note or file (read from the state)', () => {
    const s0 = withBookings(
      baseState(),
      ...Array.from({ length: 10 }, (_, i) => order({ id: `o${i}` }, i + 1)),
    );
    const text = 'Klient chce pódium o metr širší';
    const s = withMessages(
      s0,
      ...Array.from({ length: 9 }, (_, i) => msg(`o${i}`, ME, '2027-04-01', text)),
      msg('o0', ME, '2027-04-02', text), // same booking again
      msg('o9', ME, '2027-04-03', 'OK'), // too short
      msg('o9', U.petr.id, '2027-04-03', text), // someone else
    );
    expect(badge([], 'chronicle', s).count).toBe(9);
    const withFile: AppState = {
      ...s,
      attachments: [
        {
          id: 'a1',
          bookingId: 'o9',
          by: ME,
          on: '2027-04-05',
          file: { name: 'f.jpg', size: 1, key: 'k' },
        },
      ],
    };
    const b = badge([], 'chronicle', withFile);
    expect(b.count).toBe(10);
    expect(b.steps[0]?.earnedOn).toBe('2027-04-05');
  });

  it('Velká akce: a vratka of 100+ lines that brought everything back', () => {
    const big = e('vratka.session', '2027-05-01', { params: { lines: 120 } });
    const small = e('vratka.session', '2027-05-02', { params: { lines: 20 } });
    const open = e('vratka.session', '2027-05-03', { params: { lines: 150 } });
    const ledger = [
      big,
      e('vratka.settled', '2027-05-01', { parentId: big.id }),
      small,
      e('vratka.settled', '2027-05-02', { parentId: small.id }),
      open,
    ];
    expect(badge(ledger, 'bigEvent').steps[0]?.earnedOn).toBe('2027-05-01');
  });

  it('Obě skladiště: packed or received lines from Brod and from Karlák', () => {
    const s0 = withBookings(
      baseState(),
      order({
        id: 'o1',
        lines: [
          ln('l1', item('ledbeam'), 1),
          ln('l2', item('ledbeam'), 1, { sourceWarehouseId: W.karlak }),
        ],
      }),
    );
    const packing = (lineId: string, on: string) => ({
      id: `pk-${lineId}`,
      bookingId: 'o1',
      on,
      userId: ME,
      lines: [{ lineId, qty: 1 }],
    });
    const onlyBrod = { ...s0, packings: [packing('l1', '2027-04-01')] };
    expect(badge([], 'bothWarehouses', onlyBrod).earned).toBe(0);
    const both = { ...s0, packings: [packing('l1', '2027-04-01'), packing('l2', '2027-04-03')] };
    expect(badge([], 'bothWarehouses', both).steps[0]?.earnedOn).toBe('2027-04-03');
  });
});
