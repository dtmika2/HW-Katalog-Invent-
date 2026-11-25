/**
 * Date field that always reads dd.mm.yyyy. The browser's own date field follows the language of
 * the browser (mm/dd/yyyy in an English one), and a page cannot change that. Dates travel as ISO
 * days, like everywhere else.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { addDays, startOfMonth } from '@quix/core';
import { cs, fmtDate, parseDate } from '../i18n/cs';
import { useToday } from '../store';
import { MonthGrid, MonthNav } from './MonthGrid';

const STEP: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

function Picker({
  value,
  min,
  max,
  onPick,
  onClose,
}: {
  value: string;
  min: string | undefined;
  max: string | undefined;
  onPick: (d: string) => void;
  onClose: () => void;
}) {
  const today = useToday();
  const [day, setDay] = useState(value || today);
  const [month, setMonth] = useState(startOfMonth(value || today));
  const [shift, setShift] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max);

  // keep the popup on the screen, also on a phone
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const over = r.right - (document.documentElement.clientWidth - 8);
    if (over > 0) setShift(-Math.min(over, Math.max(0, r.left - 8)));
    el.scrollIntoView?.({ block: 'nearest' });
  }, []);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();
  }, [day, month]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!box.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    const step = STEP[e.key];
    if (!step || !(e.target as HTMLElement).dataset.day) return;
    e.preventDefault();
    const next = addDays(day, step);
    setDay(next);
    setMonth(startOfMonth(next));
  };

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={cs.date.pick}
      data-testid="date-picker"
      className="panel absolute left-0 top-full z-40 mt-1 w-80 max-w-[calc(100vw-1rem)] p-3 shadow-lg"
      style={{ transform: `translateX(${shift}px)` }}
      onKeyDown={onKeyDown}
    >
      <div className="mb-2 flex justify-center">
        <MonthNav month={month} onChange={setMonth} today={today} />
      </div>
      <MonthGrid
        month={month}
        renderDay={(d) => (
          <button
            type="button"
            data-day={d}
            aria-label={fmtDate(d)}
            aria-pressed={d === value}
            disabled={!allowed(d)}
            tabIndex={d === day ? 0 : -1}
            className={`h-9 w-full rounded text-sm disabled:text-muted/50 ${
              d === value
                ? 'bg-tape font-semibold text-white'
                : `enabled:hover:bg-alu ${d === today ? 'outline outline-1 outline-ink' : ''}`
            }`}
            onClick={() => onPick(d)}
          >
            {Number(d.slice(8))}
          </button>
        )}
      />
    </div>
  );
}

export function DateInput({
  id,
  value,
  onChange,
  min,
  max,
  required = false,
  disabled = false,
  narrow = false,
  'aria-label': ariaLabel,
}: {
  id?: string;
  /** ISO day, or '' when empty. */
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  /** Only as wide as a date. */
  narrow?: boolean;
  'aria-label'?: string;
}) {
  // what is being typed; undefined = the field shows `value`
  const [draft, setDraft] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const text = draft ?? (value ? fmtDate(value) : '');

  // the date was changed from elsewhere
  useEffect(() => {
    setDraft((d) => (d !== undefined && parseDate(d) !== value ? undefined : d));
  }, [value]);

  useEffect(() => {
    const iso = parseDate(text);
    const problem =
      iso === undefined
        ? cs.date.invalid
        : iso && min && iso < min
          ? cs.date.tooEarly(fmtDate(min))
          : iso && max && iso > max
            ? cs.date.tooLate(fmtDate(max))
            : '';
    input.current?.setCustomValidity(problem);
  }, [text, min, max]);

  const close = () => {
    setOpen(false);
    input.current?.focus();
  };

  return (
    <span className={`relative block ${narrow ? 'w-40' : 'w-full'}`}>
      <input
        ref={input}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className="input pr-9"
        placeholder={cs.date.placeholder}
        aria-label={ariaLabel}
        value={text}
        required={required}
        disabled={disabled}
        onChange={(e) => {
          const iso = parseDate(e.target.value);
          setDraft(e.target.value);
          if (iso !== undefined && iso !== value) onChange(iso);
        }}
        onBlur={(e) => {
          // "24.4." and "24.4.27" are completed when leaving the field
          const iso = parseDate(e.target.value, value.slice(0, 4));
          if (iso && iso !== value) onChange(iso);
          setDraft(undefined);
        }}
      />
      {!disabled && (
        <button
          type="button"
          className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-muted hover:bg-alu"
          aria-label={cs.date.pick}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
          </svg>
        </button>
      )}
      {open && (
        <Picker
          value={value}
          min={min}
          max={max}
          onPick={(d) => {
            setDraft(undefined);
            if (d !== value) onChange(d);
            close();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}
