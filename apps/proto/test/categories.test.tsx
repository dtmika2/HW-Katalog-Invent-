/**
 * Category and subcategory system: category view, labels, management, search by category.
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GALA_ID, GALA_STEPS } from '@quix/fixtures';
import { renderApp, state } from './helpers';

const cardNames = () =>
  within(screen.getByTestId('catalog-cards'))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('a')?.textContent ?? '');

describe('categories', () => {
  it('category view: tree with counts, breadcrumb, subcategory chips and labelled cards', () => {
    renderApp('/catalog', { scenario: 'base', user: 'u-petr' });
    const tree = screen.getByTestId('category-tree');
    fireEvent.click(within(tree).getByRole('button', { name: /Kabeláž/ }));
    expect(screen.getByTestId('breadcrumb')).toHaveTextContent('Celý katalog›Kabeláž');
    const chips = screen.getByRole('group', { name: 'Podkategorie' });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'Napájecí kabely 8',
      'Optické kabely 3',
      'DMX kabely 4',
      'Audio kabely 5',
      'Síťové kabely 2',
      'Video kabely 2',
    ]);
    fireEvent.click(within(chips).getByRole('button', { name: /Optické kabely/ }));
    expect(screen.getByTestId('breadcrumb')).toHaveTextContent(
      'Celý katalog›Kabeláž›Optické kabely3 položky',
    );
    expect(cardNames()).toEqual([
      'Opticon kabel 100 m',
      'Opticon kabel 50 m',
      'Optický kabel LC–LC 150 m (buben)',
    ]);
    for (const label of screen.getAllByTestId('category-label'))
      expect(label).toHaveTextContent('Kabeláž›Optické kabely');
  });

  it('deep link ?cat= opens the category; the label on an item page links back to it', () => {
    renderApp('/items/powercon-5', { scenario: 'base', user: 'u-petr' });
    const label = screen.getByTestId('category-label');
    expect(label).toHaveTextContent('Kabeláž›Napájecí kabely');
    expect(
      within(label).getByRole('link', { name: 'Zobrazit kategorii Napájecí kabely' }),
    ).toHaveAttribute('href', '/catalog?cat=kab-pwr');
    renderApp('/catalog?cat=kab-pwr', { scenario: 'base', user: 'u-petr' });
    expect(cardNames()).toContain('Kabel CEE 32 A 25 m');
    expect(cardNames()).not.toContain('DMX 5pin kabel 5 m');
  });

  it('manage categories: add a subcategory, rename it, empty ones can be deleted, non-empty cannot', () => {
    renderApp('/catalog', { scenario: 'base', user: 'u-tomas' });
    fireEvent.click(screen.getByRole('tab', { name: 'Kategorie' }));
    fireEvent.change(screen.getByLabelText('Nová podkategorie: Ostatní'), {
      target: { value: 'Měřicí technika' },
    });
    fireEvent.click(
      within(screen.getByLabelText('Nová podkategorie: Ostatní').closest('form')!).getByRole(
        'button',
        { name: 'Přidat' },
      ),
    );
    const created = state().categories.find((c) => c.name === 'Měřicí technika');
    expect(created?.parentId).toBe('ostatni');
    // duplicate name at the same level is refused
    fireEvent.change(screen.getByLabelText('Nová podkategorie: Kabeláž'), {
      target: { value: 'optické KABELY' },
    });
    fireEvent.click(
      within(screen.getByLabelText('Nová podkategorie: Kabeláž').closest('form')!).getByRole(
        'button',
        { name: 'Přidat' },
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Tento název už na této úrovni existuje.');
    // rename
    const name = screen.getByLabelText('Název: Měřicí technika');
    fireEvent.change(name, { target: { value: 'Měřáky a testery' } });
    fireEvent.blur(name);
    expect(state().categories.find((c) => c.id === created?.id)?.name).toBe('Měřáky a testery');
    // non-empty cannot be deleted
    fireEvent.click(screen.getByRole('button', { name: 'Smazat: Optické kabely' }));
    expect(state().categories.some((c) => c.id === 'kab-opt')).toBe(true);
    expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent(
      'Nelze smazat: obsahuje 3 položek',
    );
    // empty one can
    fireEvent.click(screen.getByRole('button', { name: 'Smazat: Měřáky a testery' }));
    expect(state().categories.some((c) => c.id === created?.id)).toBe(false);
  });

  it('a new top category with an icon shows up in the tree', () => {
    renderApp('/catalog', { scenario: 'base', user: 'u-tomas' });
    fireEvent.click(screen.getByRole('tab', { name: 'Kategorie' }));
    const topInput = screen.getByLabelText('Nová kategorie');
    fireEvent.change(topInput, { target: { value: 'Speciální efekty' } });
    fireEvent.click(within(topInput.closest('form')!).getByRole('button', { name: 'Přidat' }));
    expect(state().categories.find((c) => c.name === 'Speciální efekty')).toMatchObject({
      icon: 'box',
    });
    fireEvent.change(screen.getByLabelText('Ikona: Speciální efekty'), {
      target: { value: 'light' },
    });
    expect(state().categories.find((c) => c.name === 'Speciální efekty')?.icon).toBe('light');
    fireEvent.click(screen.getByRole('tab', { name: 'Karty' }));
    expect(
      within(screen.getByTestId('category-tree')).getByRole('button', { name: /Speciální efekty/ }),
    ).toBeInTheDocument();
  });

  it('the order editor search finds items by category name and shows their label', () => {
    renderApp(`/bookings/${GALA_ID}`, {
      scenario: 'galaDinner',
      user: 'u-petr',
      prepare: GALA_STEPS.create,
    });
    fireEvent.change(screen.getByLabelText('Hledat položku nebo case…'), {
      target: { value: 'optické' },
    });
    const options = within(screen.getByRole('listbox', { name: 'Přidat techniku' })).getAllByRole(
      'option',
    );
    expect(options.map((o) => o.querySelector('span')?.textContent)).toEqual([
      'Opticon kabel 100 m',
      'Opticon kabel 50 m',
      'Optický kabel LC–LC 150 m (buben)',
    ]);
    expect(options[0]).toHaveTextContent('Kabeláž›Optické kabely');
  });

  it('categories have tame colours; subcategories inherit them; the colour can be changed', () => {
    renderApp('/catalog?cat=kab-opt', { scenario: 'base', user: 'u-tomas' });
    for (const label of screen.getAllByTestId('category-label'))
      expect(label).toHaveAttribute('data-color', 'sage');
    fireEvent.click(screen.getByRole('tab', { name: 'Kategorie' }));
    const group = screen.getByRole('radiogroup', { name: 'Barva: Kabeláž' });
    expect(within(group).getByRole('radio', { name: 'šalvějová' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(group).getByRole('radio', { name: 'nebeská' }));
    expect(state().categories.find((c) => c.id === 'kabelaz')?.color).toBe('sky');
    fireEvent.click(screen.getByRole('tab', { name: 'Karty' }));
    for (const label of screen.getAllByTestId('category-label'))
      expect(label).toHaveAttribute('data-color', 'sky');
  });
});
