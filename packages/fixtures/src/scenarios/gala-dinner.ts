/**
 * The concept's model scenario: Gala Dinner, 24 Apr 2027. The base data already holds
 * "Firemní den" (PM Jana Nováková) with one AX9 case on 23–25 Apr; Petr creates the Gala
 * pre-booking during the demo. `GALA_STEPS` replays the walk-through through the API.
 */
import {
  ackConflict,
  addLine,
  completeAsStandard,
  confirmBooking,
  coverWithExternal,
  createBooking,
  detectConflicts,
  openServiceCase,
  periodWithBuffer,
  recordReturnSession,
  returnSheet,
  saveBooking,
  setServiceStatus,
  packAndShip,
  standardCaseChecks,
  startPacking,
  submitPrebooking,
  unwrap,
  type AppState,
  type Booking,
  type ReturnLineInput,
  type User,
} from '@quix/core';
import { generateState } from '../generate';

export const GALA_ID = 'bk-gala';

export function galaDinner(): AppState {
  return generateState();
}

function user(s: AppState, id: string): User {
  const u = s.users.find((x) => x.id === id);
  if (!u) throw new Error(`user ${id}`);
  return u;
}
const get = (s: AppState, id: string) => s.bookings.find((b) => b.id === id) as Booking;
const put = (s: AppState, b: Booking): AppState => ({
  ...s,
  bookings: s.bookings.map((x) => (x.id === b.id ? b : x)),
});
function caseLine(b: Booking, ct: string) {
  const l = b.lines.find((x) => 'caseTypeId' in x.target && x.target.caseTypeId === ct);
  if (!l) throw new Error(`no ${ct} line`);
  return l;
}

/** Each step of the walk-through as a state transition (used by tests and the report). */
export const GALA_STEPS = {
  /** 1–2. Petr creates the pre-booking and adds 2× AX9 case, a digital desk and a stagebox case. */
  create(s: AppState): AppState {
    const petr = user(s, 'u-petr');
    let next = unwrap(
      createBooking(s, petr, '2027-04-20', {
        id: GALA_ID,
        eventName: 'Gala Dinner',
        clientId: 'cl-grand',
        purposeMessage: 'Galavečeře pro 200 hostů v sále hotelu',
        periods: [periodWithBuffer('2027-04-24', '2027-04-24', s.settings)],
      }),
    ).state;
    let b = get(next, GALA_ID);
    b = addLine(next, b, { caseTypeId: 'ct-ax9' }, 2);
    b = addLine(next, b, { itemId: 'dlive-s5000' }, 1);
    b = addLine(next, b, { caseTypeId: 'ct-stagebox' }, 1);
    next = unwrap(saveBooking(next, petr, '2027-04-20', b));
    return next;
  },
  /** 5a. Petr ticks "I have seen the conflict" and submits. */
  submit(s: AppState): AppState {
    let b = get(s, GALA_ID);
    for (const c of detectConflicts(s, b)) b = ackConflict(b, c.lineId);
    return unwrap(submitPrebooking(put(s, b), user(s, 'u-petr'), '2027-04-20', GALA_ID));
  },
  /** 5b. Tomáš marks 8× AX9 as external rental and confirms. */
  confirm(s: AppState): AppState {
    const tomas = user(s, 'u-tomas');
    const gala = get(s, GALA_ID);
    const b = coverWithExternal(s, gala, caseLine(gala, 'ct-ax9').id, 1, {
      supplier: 'Astera Rent CZ',
      pickup: '2027-04-23',
      returnDate: '2027-04-25',
    });
    const saved = unwrap(saveBooking(s, tomas, '2027-04-20', b));
    return unwrap(confirmBooking(saved, tomas, '2027-04-20', GALA_ID));
  },
  /** 6. Packing; van 1 with whole cases, van 2 with everything else. */
  ship(s: AppState): AppState {
    const martin = user(s, 'u-martin');
    let next = unwrap(startPacking(s, martin, '2027-04-20', GALA_ID));
    const b = get(next, GALA_ID);
    const ax9 = caseLine(b, 'ct-ax9');
    const sb = caseLine(b, 'ct-stagebox');
    next = unwrap(
      packAndShip(next, martin, '2027-04-20', GALA_ID, {
        label: 'Dodávka 1',
        lines: [
          ...(
            [
              [ax9.id, 'case-ax9-02'],
              [sb.id, 'case-sb-02'],
            ] as const
          ).map(([lineId, caseId]) => ({
            lineId,
            qty: 1,
            caseIds: [caseId],
            caseChecks: standardCaseChecks(next, [caseId]),
          })),
        ],
      }),
    );
    const rest = b.lines.filter((l) => l.id !== ax9.id && l.id !== sb.id && l.status === 'ok');
    return unwrap(
      packAndShip(next, martin, '2027-04-20', GALA_ID, {
        label: 'Dodávka 2',
        lines: rest.map((l) => ({ lineId: l.id, qty: l.overriddenQty ?? l.qty })),
      }),
    );
  },
  /** 8. Vratka: AX9 case complete as standard, externals back to the supplier, one desk power cable short. */
  vratka(s: AppState): AppState {
    const lines: ReturnLineInput[] = returnSheet(s, GALA_ID).map((l): ReturnLineInput => {
      const loc = l.suggestedLocationId ?? '';
      if (l.kind === 'case') return completeAsStandard(s, l.lineId, l.pendingCaseIds[0] ?? '', loc);
      if (l.kind === 'external') {
        return {
          lineId: l.lineId,
          returnedQty: l.shipped,
          confirmed: true,
          condition: 'ok',
          returnedToSupplier: true,
        };
      }
      if (l.itemId === 'desk-power') {
        return {
          lineId: l.lineId,
          returnedQty: 0,
          confirmed: true,
          condition: 'ok',
          note: 'Zůstal v sále hotelu',
        };
      }
      return {
        lineId: l.lineId,
        returnedQty: l.shipped,
        confirmed: true,
        condition: 'ok',
        locationId: loc,
      };
    });
    return unwrap(recordReturnSession(s, user(s, 'u-martin'), '2027-04-20', GALA_ID, { lines }));
  },
  /** 9. One AX9 does not work → service case (internal, Karel, back in 14 days). */
  service(s: AppState): { state: AppState; serviceCaseId: string } {
    return unwrap(
      openServiceCase(s, user(s, 'u-martin'), '2027-04-20', {
        itemId: 'ax9',
        warehouseId: 'wh-brod',
        qty: 1,
        reason: 'Nesvítí, nereaguje na DMX',
        internal: true,
        responsibleUserId: 'u-karel',
        expectedBack: '2027-05-04',
        caseId: 'case-ax9-02',
      }),
    );
  },
  /** 10. Karel sets "Opraveno" after testing. */
  fix(s: AppState, serviceCaseId: string): AppState {
    return unwrap(
      setServiceStatus(s, user(s, 'u-karel'), '2027-05-05', serviceCaseId, 'fixed', {
        comment: 'Otestováno, funguje',
      }),
    );
  },
};
