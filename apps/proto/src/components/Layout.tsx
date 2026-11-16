import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { can, unreadCount, isIsoDate } from '@quix/core';
import { SCENARIOS, type ScenarioId } from '@quix/fixtures';
import { cs } from '../i18n/cs';
import { clearPersisted, useAppState, useProto, useToday, useUser } from '../store';
import { Toasts } from './ui';

function Bell() {
  const s = useAppState();
  const user = useUser();
  const n = unreadCount(s, user.id);
  return (
    <NavLink
      to="/notifications"
      aria-label={cs.shell.bell(n)}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded border border-alu-line bg-white hover:bg-alu"
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {n > 0 && (
        <span
          data-testid="unread"
          className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-bad px-1 text-center text-[11px] font-bold leading-5 text-white"
        >
          {n}
        </span>
      )}
    </NavLink>
  );
}

function Controls() {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const { setUser, setToday, loadScenario, runJobs, toast, scenarioId } = useProto();
  const navigate = useNavigate();
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
      <div>
        <label className="label" htmlFor="ctl-user">
          {cs.shell.user}
        </label>
        <select
          id="ctl-user"
          className="input w-auto"
          value={user.id}
          onChange={(e) => setUser(e.target.value)}
        >
          {s.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} — {cs.roles[u.role]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="ctl-scenario">
          {cs.shell.scenario}
        </label>
        <select
          id="ctl-scenario"
          className="input w-auto"
          value={scenarioId}
          onChange={(e) => {
            loadScenario(e.target.value as ScenarioId);
            navigate('/');
          }}
        >
          {SCENARIOS.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {cs.scenarios[sc.id]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="ctl-today">
          {cs.shell.today}
        </label>
        <input
          id="ctl-today"
          type="date"
          className="input w-auto"
          value={today}
          onChange={(e) => isIsoDate(e.target.value) && setToday(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => {
          const r = runJobs();
          toast('ok', cs.shell.jobsDone(r.created, r.expired));
        }}
      >
        {cs.shell.runJobs}
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => {
          if (!globalThis.confirm || globalThis.confirm(cs.shell.resetConfirm)) {
            clearPersisted();
            loadScenario(scenarioId);
            navigate('/');
          }
        }}
      >
        {cs.shell.reset}
      </button>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const links: [string, string, boolean][] = [
    ['/', cs.nav.dashboard, true],
    ['/bookings', cs.nav.bookings, true],
    ['/calendar', cs.nav.calendar, true],
    ['/catalog', cs.nav.catalog, true],
    ['/warehouse', cs.nav.warehouse, user.role === 'warehouse' || user.role === 'chief'],
    ['/service', cs.nav.service, true],
  ];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[13rem_1fr]">
      <aside className="border-b border-alu-line bg-ink text-white lg:min-h-screen lg:border-b-0">
        <div className="flex items-center justify-between px-4 py-3">
          <NavLink to="/" className="font-cond text-xl font-bold tracking-wide">
            {cs.app.title}
          </NavLink>
          <button
            type="button"
            className="text-sm underline lg:hidden"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {cs.shell.menu}
          </button>
        </div>
        <nav className={`${open ? 'block' : 'hidden'} px-2 pb-3 lg:block`}>
          {links
            .filter(([, , show]) => show)
            .map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block rounded px-3 py-2 text-sm ${isActive ? 'bg-white/15 font-semibold' : 'text-white/80 hover:bg-white/10'}`
                }
              >
                {label}
              </NavLink>
            ))}
          {can(user, 'create_booking') && (
            <NavLink
              to="/bookings/new"
              onClick={() => setOpen(false)}
              className="mt-3 block rounded bg-tape px-3 py-2 text-sm font-semibold hover:bg-tape-dark"
            >
              {cs.nav.newBooking}
            </NavLink>
          )}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex items-start justify-between gap-3 border-b border-alu-line bg-alu-dark/60 px-4 py-3">
          <Controls />
          <Bell />
        </header>
        <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
      </div>
      <Toasts />
    </div>
  );
}
