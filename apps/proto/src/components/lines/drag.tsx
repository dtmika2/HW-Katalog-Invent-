/**
 * Drag and drop with pointer events, so it works with a mouse and with a finger (the browser's
 * built-in drag does not exist on phones). Handles start a drag, elements with `data-drop` take
 * it. Everything can also be done without dragging (the "Přesunout" menu).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { Target } from '@quix/core';

export type DragPayload =
  | { kind: 'line'; id: string; label: string }
  | { kind: 'new'; target: Target; qty: number; label: string };

/** `line:<id>` nests under a line, `group:<id>` puts into a group (`group:` = no group). */
export type DropKey = string;

interface DragState {
  payload: DragPayload | undefined;
  over: DropKey | undefined;
  start: (p: DragPayload, e: ReactPointerEvent) => void;
}

const Context = createContext<DragState>({
  payload: undefined,
  over: undefined,
  start: () => undefined,
});

export const useDragState = () => useContext(Context);

const THRESHOLD = 6;
const EDGE_TOP = 70;
const EDGE_BOTTOM = 130;

export function DragProvider({
  canDrop,
  onDrop,
  children,
}: {
  canDrop: (p: DragPayload, key: DropKey) => boolean;
  onDrop: (p: DragPayload, key: DropKey) => void;
  children: ReactNode;
}) {
  const [payload, setPayload] = useState<DragPayload | undefined>();
  const [over, setOver] = useState<DropKey | undefined>();
  const ghost = useRef<HTMLDivElement>(null);
  const handlers = useRef({ canDrop, onDrop });
  handlers.current = { canDrop, onDrop };
  const stop = useRef<(() => void) | undefined>();

  // leaving the page in the middle of a drag
  useEffect(() => () => stop.current?.(), []);

  const start = useCallback((p: DragPayload, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    stop.current?.();
    const pointerId = e.pointerId;
    const from = { x: e.clientX, y: e.clientY };
    let at = { ...from };
    let active = false;
    let current: DropKey | undefined;
    let frame = 0;
    const before = document.body.style.userSelect;

    const look = () => {
      const el = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-drop]');
      const key = el?.dataset.drop;
      const next = key !== undefined && handlers.current.canDrop(p, key) ? key : undefined;
      if (next !== current) {
        current = next;
        setOver(next);
      }
      if (ghost.current)
        ghost.current.style.transform = `translate(${at.x + 12}px, ${at.y + 12}px)`;
    };
    const scroll = () => {
      const up = at.y < EDGE_TOP ? EDGE_TOP - at.y : 0;
      const down = at.y > innerHeight - EDGE_BOTTOM ? at.y - (innerHeight - EDGE_BOTTOM) : 0;
      if (up || down) {
        scrollBy(0, Math.max(-16, Math.min(16, (down - up) / 4)));
        look();
      }
      frame = requestAnimationFrame(scroll);
    };
    const end = () => {
      stop.current = undefined;
      cancelAnimationFrame(frame);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', end);
      removeEventListener('keydown', key, true);
      document.body.style.userSelect = before;
      setPayload(undefined);
      setOver(undefined);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      at = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        if (Math.hypot(at.x - from.x, at.y - from.y) < THRESHOLD) return;
        active = true;
        document.body.style.userSelect = 'none';
        setPayload(p);
        frame = requestAnimationFrame(scroll);
      }
      ev.preventDefault();
      look();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const target = active ? current : undefined;
      end();
      if (target !== undefined) handlers.current.onDrop(p, target);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      end();
    };
    addEventListener('pointermove', move, { passive: false });
    addEventListener('pointerup', up);
    addEventListener('pointercancel', end);
    addEventListener('keydown', key, true);
    stop.current = end;
  }, []);

  const value = useMemo(() => ({ payload, over, start }), [payload, over, start]);
  return (
    <Context.Provider value={value}>
      {children}
      {payload && (
        <div
          ref={ghost}
          aria-hidden="true"
          data-testid="drag-ghost"
          className="pointer-events-none fixed left-0 top-0 z-50 max-w-60 truncate rounded border border-tape bg-white px-2 py-1 text-sm font-semibold shadow-lg"
        >
          {payload.label}
        </div>
      )}
    </Context.Provider>
  );
}

/** Grip that starts a drag. The keyboard way is the "Přesunout" menu, so it is not focusable. */
export function DragHandle({ payload, title }: { payload: DragPayload; title: string }) {
  const { start } = useDragState();
  return (
    <span
      data-testid="drag-handle"
      aria-hidden="true"
      title={title}
      className="inline-grid h-10 w-8 shrink-0 md:h-7 md:w-6 cursor-grab touch-none select-none place-items-center rounded text-muted hover:bg-alu active:cursor-grabbing"
      onPointerDown={(e) => start(payload, e)}
    >
      <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor">
        {[3, 8, 13].flatMap((y) => [
          <circle key={`a${y}`} cx="2.5" cy={y} r="1.4" />,
          <circle key={`b${y}`} cx="7.5" cy={y} r="1.4" />,
        ])}
      </svg>
    </span>
  );
}
