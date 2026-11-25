/** Notification texts are rendered in Czech, including the dates inside them. */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { runDailyJobs } from '@quix/core';
import { renderApp } from './helpers';

describe('notifications', () => {
  it('dates inside notification texts use the Czech format', () => {
    renderApp('/notifications', {
      scenario: 'base',
      user: 'u-tomas',
      prepare: (s) => runDailyJobs(s, '2027-05-25').state,
    });
    const list = screen.getByTestId('notifications');
    expect(list).toHaveTextContent('předrezervace propadne 26.05.2027');
    expect(list).not.toHaveTextContent(/d{4}-d{2}-d{2}/);
  });

  it('the warehouse loading reminder shows a Czech date', () => {
    renderApp('/notifications', {
      scenario: 'base',
      user: 'u-martin',
      prepare: (s) => runDailyJobs(s, '2027-04-22').state,
    });
    const list = screen.getByTestId('notifications');
    expect(list).toHaveTextContent('nakládka 23.04.2027');
    expect(list).not.toHaveTextContent(/d{4}-d{2}-d{2}/);
  });

  it('rows are coloured by importance and always carry a text label; read ones fade', () => {
    renderApp('/notifications', {
      scenario: 'base',
      user: 'u-tomas',
      prepare: (s) => runDailyJobs(s, '2027-05-25').state,
    });
    const list = screen.getByTestId('notifications');
    const row = (text: string) => within(list).getAllByText(text)[0]!.closest('li')!;
    const urgent = row('TechConf 2027: technika po termínu nevrácena');
    expect(urgent).toHaveAttribute('data-level', 'urgent');
    expect(urgent).toHaveTextContent('Naléhavé');
    expect(urgent).toHaveClass('bg-bad-light');
    const attention = row('Konference Zdraví: předrezervace propadne 26.05.2027');
    expect(attention).toHaveAttribute('data-level', 'attention');
    expect(attention).toHaveTextContent('Pozor');
    expect(attention).toHaveClass('bg-warn-light/50');
    expect(screen.getByTestId('unread')).toHaveAttribute('data-level', 'urgent');
    expect(screen.getByRole('link', { name: /nejdůležitější: Naléhavé/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Označit vše jako přečtené' }));
    const read = row('TechConf 2027: technika po termínu nevrácena');
    expect(read).toHaveTextContent('Naléhavé');
    expect(read).not.toHaveClass('bg-bad-light');
    expect(screen.queryByTestId('unread')).toBeNull();
  });

  it('routine news is tame: info level, white row, grey bell', () => {
    renderApp('/notifications', {
      scenario: 'base',
      user: 'u-petr',
      prepare: (s) => ({
        ...s,
        notifications: [
          {
            id: 'n1',
            userId: 'u-petr',
            type: 'order_confirmed' as const,
            params: { event: 'Testovací akce' },
            text: 'confirmed',
            on: '2027-04-20',
            read: false,
          },
        ],
      }),
    });
    const li = screen.getByText('Testovací akce: objednávka potvrzena').closest('li')!;
    expect(li).toHaveAttribute('data-level', 'info');
    expect(li).toHaveTextContent('Info');
    expect(li).toHaveClass('bg-white');
    expect(screen.getByTestId('unread')).toHaveAttribute('data-level', 'info');
  });
});
