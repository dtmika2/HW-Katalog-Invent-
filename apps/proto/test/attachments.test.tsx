/** Notes and files on a booking. */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentsOf } from '@quix/core';
import { useProto } from '../src/store';
import { getFile, putFile, shrinkPhoto } from '../src/store/files';
import { renderApp, renderCurrent, state } from './helpers';

const ID = 'bk-teambuilding';
const list = () => attachmentsOf(state(), ID);
const pick = (...files: File[]) =>
  fireEvent.change(
    screen.getByTestId('attachments').querySelector('input[type="file"]') as HTMLInputElement,
    { target: { files } },
  );
const file = (name: string, size = 2000) => new File([new Uint8Array(size)], name);
const toasts = () => useProto.getState().toasts.map((t) => t.text);

beforeEach(() => {
  let n = 0;
  Object.assign(globalThis.URL, {
    createObjectURL: () => `blob:${(n += 1)}`,
    revokeObjectURL: () => undefined,
  });
  useProto.setState({ toasts: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('Poznámky a přílohy', () => {
  it('a note with who and when; removed only after a second click, by its author or the Chief', () => {
    const pm = renderApp(`/bookings/${ID}`, { scenario: 'base', user: 'u-petr' });
    fireEvent.change(screen.getByLabelText('Poznámka'), { target: { value: 'Vjezd ze dvora' } });
    fireEvent.click(screen.getByRole('button', { name: 'Přidat poznámku' }));
    expect(screen.getByLabelText('Poznámka')).toHaveValue('');
    expect(screen.getByTestId('attachment')).toHaveTextContent(
      /Vjezd ze dvora.*Petr Dvořák, 20\.04\.2027/,
    );
    expect(screen.getByText('Přidána poznámka')).toBeInTheDocument();
    pm.unmount();
    const kept = state();
    const other = renderApp(`/bookings/${ID}`, {
      scenario: 'base',
      user: 'u-lucie',
      prepare: () => kept,
    });
    expect(screen.getByText('Vjezd ze dvora')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Smazat:/ })).toBeNull();
    other.unmount();
    renderApp(`/bookings/${ID}`, { scenario: 'base', user: 'u-tomas', prepare: () => kept });
    fireEvent.click(screen.getByRole('button', { name: 'Smazat: Poznámka' }));
    expect(list()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Opravdu smazat' }));
    expect(list()).toEqual([]);
  });

  it('several files at once; pictures are enlarged, PDFs open in a new tab, the rest downloads', async () => {
    renderApp(`/bookings/${ID}`, { scenario: 'base', user: 'u-petr' });
    pick(file('sal.jpg'), file('smlouva.pdf'), file('plan.dwg'));
    await waitFor(() => expect(list()).toHaveLength(3));
    expect(await getFile(list()[0]!.file!.key)).toBeInstanceOf(Blob);
    const pdf = await screen.findByRole('link', { name: 'smlouva.pdf' });
    expect(pdf).toHaveAttribute('target', '_blank');
    expect(pdf).not.toHaveAttribute('download');
    expect(await screen.findByRole('link', { name: 'plan.dwg' })).toHaveAttribute(
      'download',
      'plan.dwg',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Zvětšit: sal.jpg' }));
    const big = screen.getByRole('dialog', { name: 'sal.jpg' });
    expect(within(big).getByRole('link', { name: 'Stáhnout' })).toHaveAttribute('download');
    fireEvent.keyDown(big, { key: 'Escape' });
    expect(screen.queryByTestId('enlarged')).toBeNull();
    expect(screen.getByText('Přidána příloha: smlouva.pdf')).toBeInTheDocument();
  });

  it('forbidden, empty and too big files are refused with the reason, good ones still added', async () => {
    renderApp(`/bookings/${ID}`, { scenario: 'base', user: 'u-petr' });
    pick(
      file('stranka.html'),
      file('logo.svg'),
      file('prazdny.pdf', 0),
      file('velky.pdf', 10 * 1024 * 1024 + 1),
      file('ok.pdf'),
    );
    await waitFor(() => expect(list().map((a) => a.file?.name)).toEqual(['ok.pdf']));
    expect(toasts()).toEqual([
      expect.stringMatching(/stranka\.html: tento typ/),
      expect.stringMatching(/logo\.svg: tento typ/),
      'prazdny.pdf: soubor je prázdný.',
      'velky.pdf: soubor je větší než 10 MB.',
    ]);
  });

  it('a file whose contents are elsewhere says so; deleting removes the contents', async () => {
    const page = renderApp(`/bookings/${ID}`, { scenario: 'base', user: 'u-petr' });
    pick(file('a.pdf'));
    await waitFor(() => expect(list()).toHaveLength(1));
    const key = list()[0]!.file!.key;
    fireEvent.click(screen.getByRole('button', { name: 'Smazat: a.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opravdu smazat' }));
    await waitFor(async () => expect(await getFile(key)).toBeUndefined());
    page.unmount();
    const s = state();
    renderApp(`/bookings/${ID}`, {
      scenario: 'base',
      user: 'u-petr',
      prepare: () => ({
        ...s,
        attachments: [
          {
            id: 'att-x',
            bookingId: ID,
            by: 'u-petr',
            on: '2027-04-20',
            file: { name: 'jinde.pdf', size: 10, key: 'nic' },
          },
        ],
      }),
    });
    expect(
      await screen.findByText('Soubor je jen v prohlížeči, kde byl přidán.'),
    ).toBeInTheDocument();
  });

  it('the warehouse reads them at packing, shipping and vratka, without adding or deleting', () => {
    const first = renderApp('/', { scenario: 'base', user: 'u-martin' });
    const s = state();
    const b = s.bookings.find((x) => x.status === 'shipped')!;
    first.unmount();
    const start = renderApp('/', {
      scenario: 'base',
      user: 'u-martin',
      prepare: () => ({
        ...s,
        attachments: [
          { id: 'att-1', bookingId: b.id, by: 'u-martin', on: '2027-04-20', text: 'Rampa vlevo' },
        ],
      }),
    });
    start.unmount();
    for (const path of ['packing', 'shipping', 'vratka']) {
      const page = renderCurrent(`/${path}/${b.id}`);
      const box = within(screen.getByTestId('attachments'));
      expect(box.getByText('Poznámky a přílohy (1)')).toBeInTheDocument();
      expect(box.getByText('Rampa vlevo')).toBeInTheDocument();
      expect(box.queryByRole('button')).toBeNull();
      page.unmount();
    }
  });

  it('not on any paper', () => {
    const first = renderApp('/', { scenario: 'base', user: 'u-petr' });
    const s = state();
    first.unmount();
    renderApp(`/bookings/${ID}`, {
      scenario: 'base',
      user: 'u-petr',
      prepare: () => ({
        ...s,
        attachments: [
          { id: 'att-1', bookingId: ID, by: 'u-petr', on: '2027-04-20', text: 'Interní' },
        ],
      }),
    });
    expect(screen.getByTestId('booking-print')).not.toHaveTextContent('Interní');
  });

  it('loading another scenario throws the contents away', async () => {
    await putFile('k1', new Blob(['x']));
    useProto.getState().loadScenario('base');
    await waitFor(async () => expect(await getFile('k1')).toBeUndefined());
  });

  it('what is not a picture is left as it is', async () => {
    const f = file('velke.jpg', 2 * 1024 * 1024);
    expect((await shrinkPhoto(f)).blob).toBe(f);
    expect((await shrinkPhoto(file('a.pdf'))).name).toBe('a.pdf');
  });
});
