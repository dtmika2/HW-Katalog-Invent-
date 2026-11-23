import { useEffect, useId, useRef, useState } from 'react';
import { SCENARIOS, type ScenarioId } from '@quix/fixtures';
import { cs } from '../i18n/cs';

/** "?" next to the scenario picker: what each scenario shows. Opens on hover, focus or tap. */
export function ScenarioHelp({ current }: { current: ScenarioId }) {
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ left: 0, width: 448 });

  const show = () => {
    // Keep the panel inside the window on narrow screens.
    const x = wrap.current?.getBoundingClientRect().left ?? 0;
    const width = Math.min(448, document.documentElement.clientWidth - 32);
    setPlace({
      width,
      left: Math.min(0, document.documentElement.clientWidth - 16 - width - x),
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <span
      ref={wrap}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={() => document.activeElement !== button.current && setOpen(false)}
    >
      <button
        ref={button}
        type="button"
        className="-my-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-alu-line bg-white text-xs font-bold text-ink-soft hover:bg-alu"
        aria-label={cs.shell.scenarioHelp}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onClick={show}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span
          className="absolute top-full z-40 block pt-1"
          style={{ left: place.left, width: place.width }}
        >
          <span
            id={id}
            role="tooltip"
            className="panel block max-h-[75vh] overflow-y-auto p-3 text-sm shadow-lg"
          >
            <span className="mb-2 block text-xs text-muted">{cs.shell.scenarioNote}</span>
            {SCENARIOS.map((sc) => {
              const info = cs.scenarioInfo[sc.id];
              const active = sc.id === current;
              return (
                <span
                  key={sc.id}
                  data-scenario={sc.id}
                  data-current={active}
                  className={`mb-2 block rounded border-l-4 last:mb-0 px-2 py-1 ${active ? 'border-l-tape bg-tape-light' : 'border-l-alu-line'}`}
                >
                  <span className="block font-semibold">
                    {cs.scenarios[sc.id]}
                    {active && (
                      <span className="ml-2 text-xs font-normal text-tape-dark">
                        {cs.shell.scenarioCurrent}
                      </span>
                    )}
                  </span>
                  <span className="block">
                    <span className="text-muted">{cs.shell.scenarioSee}</span> {info?.see}
                  </span>
                  <span className="block">
                    <span className="text-muted">{cs.shell.scenarioTeaches}</span> {info?.teaches}
                  </span>
                </span>
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
}
