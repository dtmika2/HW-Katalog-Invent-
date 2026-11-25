/** Dates are dd.mm.yyyy everywhere, in texts and in fields. */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fmtDate, fmtRange, fmtShort, parseDate } from '../src/i18n/cs';
import { useProto } from '../src/store';
import { booking, renderApp } from './helpers';

describe('formatting and reading dates', () => {
  it('dd.mm.yyyy, ranges share what they can', () => {
    expect(fmtDate('2027-04-05')).toBe('05.04.2027');
    expect(fmtShort('2027-04-05')).toBe('05.04.');
    expect(fmtRange('2027-04-23', '2027-04-25')).toBe('23.–25.04.2027');
    expect(fmtRange('2027-04-30', '2027-05-02')).toBe('30.04.–02.05.2027');
    expect(fmtRange('2027-12-30', '2028-01-02')).toBe('30.12.2027–02.01.2028');
    expect(fmtRange('2027-04-05', '2027-04-05')).toBe('05.04.2027');
  });

  it('reads Czech spellings, refuses other ones and impossible days', () => {
    for (const t of ['24.04.2027', '24.4.2027', ' 24.04.2027 ', '24042027', '2027-04-24'])
      expect(parseDate(t), t).toBe('2027-04-24');
    for (const t of ['04/24/2027', '31.02.2027', '24.13.2027', '24.04.20', '24.04.', 'zítra'])
      expect(parseDate(t), t).toBeUndefined();
    expect(parseDate('')).toBe('');
    expect(parseDate('24.4.', '2027')).toBe('2027-04-24');
    expect(parseDate('24.4.28', '2027')).toBe('2028-04-24');
  });
});

describe('date field', () => {
  const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  const type = (label: string, v: string) =>
    fireEvent.change(field(label), { target: { value: v } });

  it('shows dd.mm.yyyy and no field depends on the browser language', () => {
    renderApp('/bookings/bk-teambuilding', { scenario: 'base', user: 'u-petr' });
    expect(field('Simulované dnes')).toHaveValue('20.04.2027');
    expect(field('Akce od')).toHaveValue('29.05.2027');
    expect(document.querySelectorAll('input[type=date]')).toHaveLength(0);
  });

  it('typing takes effect when the date is whole; leaving completes or puts it back', () => {
    renderApp('/', { scenario: 'base', user: 'u-petr' });
    const today = () => useProto.getState().today;
    type('Simulované dnes', '01.05.20');
    expect(today()).toBe('2027-04-20');
    expect(field('Simulované dnes')).toHaveValue('01.05.20');
    type('Simulované dnes', '01.05.2027');
    expect(today()).toBe('2027-05-01');
    type('Simulované dnes', '3.5.');
    fireEvent.blur(field('Simulované dnes'));
    expect(today()).toBe('2027-05-03');
    expect(field('Simulované dnes')).toHaveValue('03.05.2027');
    type('Simulované dnes', 'nesmysl');
    expect(field('Simulované dnes').validationMessage).toMatch(/dd\.mm\.rrrr/);
    fireEvent.blur(field('Simulované dnes'));
    expect(field('Simulované dnes')).toHaveValue('03.05.2027');
    expect(field('Simulované dnes').validationMessage).toBe('');
  });

  it('the calendar is Czech, picks a day, respects the earliest day and closes on Escape', () => {
    renderApp('/items/walkie?loan=1', { scenario: 'base', user: 'u-petr' });
    const wrap = field('Od').parentElement as HTMLElement;
    const openIt = () =>
      fireEvent.click(within(wrap).getByRole('button', { name: 'Vybrat datum v kalendáři' }));
    openIt();
    const cal = within(screen.getByTestId('date-picker'));
    expect(cal.getByTestId('month-title')).toHaveTextContent('duben 2027');
    expect(cal.getByText('Po')).toBeInTheDocument();
    expect(cal.getByRole('button', { name: '19.04.2027' })).toBeDisabled();
    fireEvent.click(cal.getByRole('button', { name: 'Další měsíc' }));
    fireEvent.click(cal.getByRole('button', { name: '07.05.2027' }));
    expect(field('Od')).toHaveValue('07.05.2027');
    expect(screen.queryByTestId('date-picker')).toBeNull();
    openIt();
    const day = within(screen.getByTestId('date-picker')).getByRole('button', {
      name: '07.05.2027',
    });
    expect(day).toHaveFocus();
    fireEvent.keyDown(day, { key: 'ArrowDown' });
    expect(
      within(screen.getByTestId('date-picker')).getByRole('button', { name: '14.05.2027' }),
    ).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByTestId('date-picker')).toBeNull();
    openIt();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('date-picker')).toBeNull();
    // a date before today can be typed, but not sent
    type('Od', '01.04.2027');
    expect(field('Od').validationMessage).toBe('Nejdřív 20.04.2027.');
  });

  it('a date that is not allowed there is put back when leaving the field', () => {
    renderApp('/bookings/bk-teambuilding', { scenario: 'base', user: 'u-petr' });
    const before = booking('bk-teambuilding')!.periods[0]!.bookedFrom;
    const f = field('Rezervováno (vč. balení a vratky)');
    expect(f).toHaveValue(fmtDate(before));
    fireEvent.change(f, { target: { value: '30.05.2027' } });
    fireEvent.blur(f);
    expect(f).toHaveValue(fmtDate(before));
  });

  it('readers get the date without a calendar button', () => {
    renderApp('/bookings/bk-firemni', { scenario: 'base', user: 'u-martin' });
    expect(field('Akce od')).toBeDisabled();
    expect(within(field('Akce od').parentElement as HTMLElement).queryByRole('button')).toBeNull();
  });
});
