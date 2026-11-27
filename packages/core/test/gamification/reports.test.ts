import { describe, expect, it } from 'vitest';
import {
  computeLedger,
  openServiceCase,
  recordReturnSession,
  resolveIssue,
  setServiceStatus,
  unwrap,
  type AppState,
  type Issue,
  type ServiceStatus,
} from '../../src';
import { baseState, item, L, ln, order, U, W, withBookings } from '../helpers';
import { of, pts } from './helpers';

const T = '2027-04-20';

/** Martin reports a broken hazer by hand; Karel is responsible. */
function reported(): { s: AppState; id: string } {
  const r = unwrap(
    openServiceCase(baseState(), U.martin, T, {
      itemId: 'hazer',
      warehouseId: W.brod,
      qty: 1,
      reason: 'Nefunguje čerpadlo',
      responsibleUserId: U.karel.id,
    }),
  );
  return { s: r.state, id: r.serviceCaseId };
}

const step = (s: AppState, id: string, status: ServiceStatus, on = '2027-04-22') =>
  unwrap(setServiceStatus(s, U.karel, on, id, status));

describe('gamification: reports and service', () => {
  it('report.fault gives 8 points for a fault reported by hand', () => {
    const { s } = reported();
    const e = of(computeLedger(s), 'report.fault');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ userId: U.martin.id, on: T, points: 8 });
  });

  it('report.fault is not given for damage found in a vratka (the vratka rewards it)', () => {
    const s0: AppState = {
      ...withBookings(
        baseState(),
        order({ id: 'o1', status: 'shipped', lines: [ln('l1', item('hazer'), 1)] }),
      ),
      shipments: [
        {
          id: 'sh-1',
          bookingId: 'o1',
          label: 'D1',
          shippedOn: '2027-04-22',
          userId: U.martin.id,
          lines: [{ lineId: 'l1', qty: 1 }],
        },
      ],
    };
    const s = unwrap(
      recordReturnSession(s0, U.karel, '2027-04-25', 'o1', {
        lines: [
          {
            lineId: 'l1',
            returnedQty: 1,
            confirmed: true,
            condition: 'damaged',
            note: 'Nefunguje',
            locationId: L.brodA,
          },
        ],
      }),
    );
    expect(s.serviceCases).toHaveLength(1);
    expect(of(computeLedger(s), 'report.fault')).toHaveLength(0);
    const fixed = step(s, s.serviceCases[0]!.id, 'fixed', '2027-04-28');
    const e = of(computeLedger(fixed), 'report.confirmed');
    expect(e[0]).toMatchObject({ userId: U.karel.id, points: 5, bookingId: 'o1' });
  });

  it('report.confirmed gives the reporter +5 when the case ends repaired or written off', () => {
    const { s, id } = reported();
    expect(of(computeLedger(s), 'report.confirmed')).toHaveLength(0);
    const fixed = step(s, id, 'fixed', '2027-04-25');
    const e = of(computeLedger(fixed), 'report.confirmed');
    expect(e[0]).toMatchObject({
      userId: U.martin.id,
      on: '2027-04-25',
      points: 5,
      parentId: `report.fault:${id}`,
    });
    const written = step(reported().s, id, 'written_off');
    expect(pts(computeLedger(written), 'report.confirmed')).toBe(5);
  });

  it('service.progress gives 3 points per status change, at most 5 per case', () => {
    const { s: s0, id } = reported();
    let s = s0;
    const flow: ServiceStatus[] = [
      'in_progress',
      'waiting_parts',
      'in_progress',
      'external',
      'back_to_check',
      'in_progress',
      'back_to_check',
    ];
    for (const st of flow) s = step(s, id, st);
    const e = of(computeLedger(s), 'service.progress');
    expect(e).toHaveLength(5);
    expect(e.every((x) => x.userId === U.karel.id && x.points === 3)).toBe(true);
  });

  it('service.fixed gives 10 points to whoever sets Opraveno (not counted as progress)', () => {
    const { s, id } = reported();
    const l = computeLedger(step(step(s, id, 'in_progress'), id, 'fixed'));
    expect(of(l, 'service.fixed')[0]).toMatchObject({ userId: U.karel.id, points: 10 });
    expect(of(l, 'service.progress')).toHaveLength(1);
  });

  it('issue.resolved gives 6 points for an issue resolved with a written resolution', () => {
    const issue: Issue = {
      id: 'iss-1',
      type: 'missing',
      itemId: 'deskpower',
      qty: 1,
      warehouseId: W.brod,
      reportedBy: U.karel.id,
      reportedOn: T,
    };
    const s0 = { ...baseState(), issues: [issue] };
    const s = unwrap(resolveIssue(s0, U.tomas, '2027-04-21', 'iss-1', 'found', 'Byl v jiném casu'));
    expect(of(computeLedger(s), 'issue.resolved')[0]).toMatchObject({
      userId: U.tomas.id,
      on: '2027-04-21',
      points: 6,
    });
  });

  it('issue.resolved is not given for the automatic closure when pieces turn up', () => {
    const issue: Issue = {
      id: 'iss-1',
      type: 'missing',
      itemId: 'deskpower',
      qty: 1,
      reportedBy: U.karel.id,
      reportedOn: T,
      archivedOn: '2027-04-26',
      resolutionKind: 'found',
      resolution: 'returned-later',
      resolvedBy: U.karel.id,
    };
    expect(computeLedger({ ...baseState(), issues: [issue] })).toEqual([]);
  });

  it('issues themselves earn nothing: they are created automatically from counts', () => {
    const issue: Issue = {
      id: 'iss-1',
      type: 'missing',
      itemId: 'deskpower',
      qty: 1,
      reportedBy: U.karel.id,
      reportedOn: T,
    };
    expect(computeLedger({ ...baseState(), issues: [issue] })).toEqual([]);
  });
});
