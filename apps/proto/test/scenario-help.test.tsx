/** Explanations next to the scenario picker. */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '@quix/fixtures';
import { cs } from '../src/i18n/cs';
import { renderApp } from './helpers';

const help = () => screen.getByRole('button', { name: 'Co scénáře ukazují' });

describe('scenario help', () => {
  it('every scenario has an explanation', () => {
    for (const sc of SCENARIOS) {
      expect(cs.scenarioInfo[sc.id]?.see).toBeTruthy();
      expect(cs.scenarioInfo[sc.id]?.teaches).toBeTruthy();
    }
  });

  it('opens on focus, explains all scenarios, marks the current one and closes on Escape', () => {
    renderApp('/', { scenario: 'conflictChain', user: 'u-jana' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(help());
    const tip = screen.getByRole('tooltip');
    expect(help()).toHaveAttribute('aria-expanded', 'true');
    expect(tip.querySelectorAll('[data-scenario]')).toHaveLength(SCENARIOS.length);
    const current = tip.querySelectorAll<HTMLElement>('[data-current="true"]');
    expect(current).toHaveLength(1);
    expect(within(current[0]!).getByText('Řetěz konfliktů (LEDBeam, červen)')).toBeInTheDocument();
    expect(current[0]).toHaveTextContent('tři rezervace se překrývají');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on hover and on tap; tapping elsewhere closes it', () => {
    renderApp('/', { scenario: 'base', user: 'u-petr' });
    fireEvent.mouseEnter(help().parentElement!);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(help().parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(help());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
