/** Notification texts are rendered in Czech, including the dates inside them. */
import { screen } from '@testing-library/react';
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
    expect(list).toHaveTextContent('předrezervace propadne 26. 5. 2027');
    expect(list).not.toHaveTextContent(/d{4}-d{2}-d{2}/);
  });

  it('the warehouse loading reminder shows a Czech date', () => {
    renderApp('/notifications', {
      scenario: 'base',
      user: 'u-martin',
      prepare: (s) => runDailyJobs(s, '2027-04-22').state,
    });
    const list = screen.getByTestId('notifications');
    expect(list).toHaveTextContent('nakládka 23. 4. 2027');
    expect(list).not.toHaveTextContent(/d{4}-d{2}-d{2}/);
  });
});
