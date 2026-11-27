import { describe, expect, it } from 'vitest';
import {
  addNote,
  computeLedger,
  createLoan,
  postMessage,
  returnLoan,
  unwrap,
  type AppState,
  type Attachment,
  type LoanInput,
  type User,
} from '../../src';
import { baseState, order, U, W, withBookings } from '../helpers';
import { msg, of, pts, withMessages } from './helpers';

const T = '2027-04-20';
const TEXT = 'Klient chce pódium o metr širší';
const base = () => withBookings(baseState(), order({ id: 'o1' }), order({ id: 'o2' }, 2));

describe('gamification: communication', () => {
  it('talk.message gives 2 points for a message of 15+ characters', () => {
    const s = postMessage(base(), U.petr, 'o1', TEXT, T);
    expect(of(computeLedger(s), 'talk.message')[0]).toMatchObject({ userId: U.petr.id, points: 2 });
    const short = postMessage(base(), U.petr, 'o1', 'OK, díky', T);
    expect(computeLedger(short)).toEqual([]);
  });

  it('talk.message counts at most 3 per booking and day', () => {
    const many = Array.from({ length: 5 }, (_, i) => msg('o1', U.petr.id, T, `${TEXT} (${i})`));
    const s = withMessages(base(), ...many);
    expect(of(computeLedger(s), 'talk.message')).toHaveLength(3);
    const next = withMessages(s, msg('o1', U.petr.id, '2027-04-21', TEXT));
    expect(of(computeLedger(next), 'talk.message')).toHaveLength(4);
  });

  it('talk.message counts at most 10 per day', () => {
    const bookings = Array.from({ length: 5 }, (_, i) => order({ id: `b${i}` }, i + 10));
    const s0 = withBookings(baseState(), ...bookings);
    const many = bookings.flatMap((b) =>
      [1, 2, 3].map((n) => msg(b.id, U.petr.id, T, `${TEXT} ${n}`)),
    );
    expect(of(computeLedger(withMessages(s0, ...many)), 'talk.message')).toHaveLength(10);
  });

  it('talk.reply gives +1 for answering another person within a day', () => {
    const s = withMessages(
      base(),
      msg('o1', U.petr.id, T, TEXT),
      msg('o1', U.tomas.id, '2027-04-21', 'Širší pódium máme, přidám díly'),
      msg('o1', U.tomas.id, '2027-04-21', 'A ještě schůdky na druhou stranu'),
      msg('o1', U.petr.id, '2027-04-25', 'Děkuji, posílám klientovi'),
    );
    const replies = of(computeLedger(s), 'talk.reply');
    // Tomáš answers (twice, Petr's message is the last other one within a day); Petr after 4 days does not.
    expect(replies.map((r) => r.userId)).toEqual([U.tomas.id, U.tomas.id]);
    expect(replies.every((r) => r.points === 1 && r.parentId?.startsWith('talk.message:'))).toBe(
      true,
    );
  });

  it('talk.reply goes with its message when the message is over the daily limit', () => {
    const own = Array.from({ length: 3 }, (_, i) => msg('o1', U.tomas.id, T, `${TEXT} ${i}`));
    const s = withMessages(
      base(),
      ...own,
      msg('o1', U.petr.id, T, TEXT),
      msg('o1', U.tomas.id, T, `${TEXT} 4`),
    );
    expect(of(computeLedger(s), 'talk.reply').filter((r) => r.userId === U.tomas.id)).toHaveLength(
      0,
    );
  });

  it('talk.note gives 3 points for a note of 15+ characters, at most 5 per day', () => {
    let s = base();
    for (let i = 0; i < 6; i++) s = unwrap(addNote(s, U.petr, T, 'o1', `${TEXT} ${i}`));
    const e = of(computeLedger(s), 'talk.note');
    expect(e).toHaveLength(5);
    expect(e[0]?.points).toBe(3);
    expect(
      of(computeLedger(unwrap(addNote(base(), U.petr, T, 'o1', 'Pozor'))), 'talk.note'),
    ).toHaveLength(0);
  });

  it('talk.file gives 4 points per file, at most 5 per day; a removed file no longer counts', () => {
    const file = (i: number): Attachment => ({
      id: `att-${i}`,
      bookingId: 'o1',
      by: U.martin.id,
      on: T,
      file: { name: `foto${i}.jpg`, size: 100, key: `k${i}` },
    });
    const s: AppState = { ...base(), attachments: [1, 2, 3, 4, 5, 6].map(file) };
    expect(pts(computeLedger(s), 'talk.file')).toBe(20);
    expect(of(computeLedger({ ...s, attachments: [] }), 'talk.file')).toHaveLength(0);
  });
});

describe('gamification: loans', () => {
  const loan = (input: Partial<LoanInput> = {}, by: User = U.petr) =>
    unwrap(
      createLoan(baseState(), by, T, {
        itemId: 'hazer',
        warehouseId: W.brod,
        qty: 1,
        until: '2027-04-23',
        ...input,
      }),
    );

  it('loan.recorded gives 2 points for a loan recorded with an expected return', () => {
    const { state } = loan();
    expect(of(computeLedger(state), 'loan.recorded')[0]).toMatchObject({
      userId: U.petr.id,
      points: 2,
    });
    const { state: undated } = loan({ until: undefined });
    expect(computeLedger(undated)).toEqual([]);
  });

  it('loan.returnedOnTime gives the borrower 3 points', () => {
    const { state, loanId } = loan();
    const back = unwrap(returnLoan(state, U.petr, '2027-04-23', loanId));
    expect(pts(computeLedger(back), 'loan.returnedOnTime')).toBe(3);
    const late = unwrap(returnLoan(state, U.petr, '2027-04-24', loanId));
    expect(of(computeLedger(late), 'loan.returnedOnTime')).toHaveLength(0);
  });

  it('loan.returnedFor gives 2 points for returning somebody else’s loan', () => {
    const { state, loanId } = loan();
    const back = unwrap(returnLoan(state, U.martin, '2027-04-22', loanId));
    const l = computeLedger(back);
    expect(of(l, 'loan.returnedFor')[0]).toMatchObject({ userId: U.martin.id, points: 2 });
    expect(of(l, 'loan.returnedOnTime')[0]).toMatchObject({ userId: U.petr.id });
  });

  it('a loan for somebody without an account gives no on-time points to anyone', () => {
    const { state, loanId } = loan({ borrowerName: 'Externí technik' }, U.martin);
    const back = unwrap(returnLoan(state, U.martin, '2027-04-22', loanId));
    const l = computeLedger(back);
    expect(of(l, 'loan.returnedOnTime')).toHaveLength(0);
    expect(of(l, 'loan.returnedFor')[0]).toMatchObject({ userId: U.martin.id });
  });
});
