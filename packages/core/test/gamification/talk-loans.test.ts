import { describe, expect, it } from 'vitest';
import {
  addNote,
  computeLedger,
  createLoan,
  POOLS,
  postMessage,
  returnLoan,
  RULES,
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

const BUDGET = POOLS.talk.perWeek;
const talkPoints = (s: AppState, userId: string) =>
  computeLedger(s)
    .filter((e) => e.category === 'talk' && e.userId === userId)
    .reduce((n, e) => n + e.points, 0);

describe('gamification: communication', () => {
  it('talk.message gives points for a message of 15+ characters', () => {
    const s = postMessage(base(), U.petr, 'o1', TEXT, T);
    expect(of(computeLedger(s), 'talk.message')[0]).toMatchObject({
      userId: U.petr.id,
      points: RULES['talk.message'].points,
    });
    const short = postMessage(base(), U.petr, 'o1', 'OK, díky', T);
    expect(computeLedger(short)).toEqual([]);
  });

  it('all communication of a person shares one weekly budget, however much is written', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      msg(i % 2 ? 'o1' : 'o2', U.petr.id, T, `${TEXT} (${i})`),
    );
    const s = withMessages(base(), ...many);
    expect(talkPoints(s, U.petr.id)).toBe(BUDGET);
    const next = withMessages(s, msg('o1', U.petr.id, '2027-04-27', TEXT));
    expect(talkPoints(next, U.petr.id)).toBe(BUDGET + RULES['talk.message'].points);
  });

  it('the weekly budget runs Monday to Sunday', () => {
    const sunday = Array.from({ length: 6 }, (_, i) =>
      msg('o1', U.petr.id, '2027-04-25', `${TEXT} ${i}`),
    );
    const monday = Array.from({ length: 6 }, (_, i) =>
      msg('o1', U.petr.id, '2027-04-26', `${TEXT} ${i}`),
    );
    expect(talkPoints(withMessages(base(), ...sunday, ...monday), U.petr.id)).toBe(2 * BUDGET);
  });

  it('the budget is per person', () => {
    const s = withMessages(
      base(),
      ...Array.from({ length: 6 }, (_, i) => msg('o1', U.petr.id, T, `${TEXT} ${i}`)),
      ...Array.from({ length: 6 }, (_, i) => msg('o1', U.lucie.id, T, `${TEXT} ${i}`)),
    );
    expect(talkPoints(s, U.petr.id)).toBe(BUDGET);
    expect(talkPoints(s, U.lucie.id)).toBe(BUDGET);
  });

  it('talk.reply gives a bonus for answering another person within a day', () => {
    const s = withMessages(
      base(),
      msg('o1', U.petr.id, T, TEXT),
      msg('o1', U.tomas.id, '2027-04-21', 'Širší pódium máme, přidám díly'),
      msg('o1', U.petr.id, '2027-04-27', 'Děkuji, posílám klientovi'),
    );
    const replies = of(computeLedger(s), 'talk.reply');
    // Tomáš answers within a day; Petr's answer comes 6 days later.
    expect(replies.map((r) => r.userId)).toEqual([U.tomas.id]);
    expect(replies[0]).toMatchObject({
      points: RULES['talk.reply'].points,
      parentId: expect.stringMatching(/^talk\.message:/),
    });
  });

  it('talk.reply goes with its message when the message is over the weekly budget', () => {
    const own = Array.from({ length: BUDGET }, (_, i) => msg('o2', U.tomas.id, T, `${TEXT} ${i}`));
    const s = withMessages(
      base(),
      ...own,
      msg('o1', U.petr.id, T, TEXT),
      msg('o1', U.tomas.id, T, `${TEXT} odpověď`),
    );
    expect(of(computeLedger(s), 'talk.reply')).toHaveLength(0);
    expect(talkPoints(s, U.tomas.id)).toBe(BUDGET);
  });

  it('talk.note gives points for a note of 15+ characters, within the budget', () => {
    const one = unwrap(addNote(base(), U.petr, T, 'o1', TEXT));
    expect(pts(computeLedger(one), 'talk.note')).toBe(RULES['talk.note'].points);
    let s = base();
    for (let i = 0; i < 6; i++) s = unwrap(addNote(s, U.petr, T, 'o1', `${TEXT} ${i}`));
    expect(talkPoints(s, U.petr.id)).toBe(BUDGET);
    const short = unwrap(addNote(base(), U.petr, T, 'o1', 'Pozor'));
    expect(of(computeLedger(short), 'talk.note')).toHaveLength(0);
  });

  it('talk.file gives points per file, within the budget; a removed file no longer counts', () => {
    const file = (i: number): Attachment => ({
      id: `att-${i}`,
      bookingId: 'o1',
      by: U.martin.id,
      on: T,
      file: { name: `foto${i}.jpg`, size: 100, key: `k${i}` },
    });
    const s: AppState = { ...base(), attachments: [1, 2, 3, 4, 5, 6].map(file) };
    expect(of(computeLedger({ ...base(), attachments: [file(1)] }), 'talk.file')[0]?.points).toBe(
      RULES['talk.file'].points,
    );
    expect(talkPoints(s, U.martin.id)).toBe(BUDGET);
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
