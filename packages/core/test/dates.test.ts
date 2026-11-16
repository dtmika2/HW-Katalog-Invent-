import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  compareDates,
  diffDays,
  eachDay,
  endOfMonth,
  inRange,
  isIsoDate,
  rangesOverlap,
  startOfMonth,
  weekday,
} from '../src';

describe('dates', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2027-04-30', 1)).toBe('2027-05-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('diffDays counts calendar days', () => {
    expect(diffDays('2027-04-20', '2027-04-25')).toBe(5);
    expect(diffDays('2027-04-25', '2027-04-20')).toBe(-5);
  });
  it('iterates a range inclusively', () => {
    expect(eachDay('2027-04-22', '2027-04-25')).toEqual([
      '2027-04-22',
      '2027-04-23',
      '2027-04-24',
      '2027-04-25',
    ]);
    expect(eachDay('2027-04-25', '2027-04-22')).toEqual([]);
  });
  it('compares and checks ranges', () => {
    expect(compareDates('2027-04-01', '2027-04-02')).toBe(-1);
    expect(compareDates('2027-04-02', '2027-04-02')).toBe(0);
    expect(compareDates('2027-04-03', '2027-04-02')).toBe(1);
    expect(inRange('2027-04-22', '2027-04-22', '2027-04-25')).toBe(true);
    expect(inRange('2027-04-26', '2027-04-22', '2027-04-25')).toBe(false);
    expect(rangesOverlap('2027-04-01', '2027-04-05', '2027-04-05', '2027-04-07')).toBe(true);
    expect(rangesOverlap('2027-04-01', '2027-04-04', '2027-04-05', '2027-04-07')).toBe(false);
  });
  it('validates ISO dates', () => {
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('27-1-1')).toBe(false);
  });
  it('month helpers and weekday', () => {
    expect(startOfMonth('2027-04-20')).toBe('2027-04-01');
    expect(endOfMonth('2027-02-10')).toBe('2027-02-28');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2027-04-01', -1)).toBe('2027-03-01');
    expect(weekday('2027-04-19')).toBe(0); // Monday
    expect(weekday('2027-04-25')).toBe(6); // Sunday
  });
  it('rejects malformed dates in arithmetic', () => {
    expect(() => addDays('nope', 1)).toThrow();
  });
});
