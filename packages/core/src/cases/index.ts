/**
 * Flight case completeness and refill ("Doplnit case") tasks. Cases always go back to full:
 * refilling moves pieces from loose stock into the case.
 */
import { diffDays, type IsoDate } from '../dates';
import { caseMissing, contentsMatchStandard, refillTasks } from '../catalog';
import { can } from '../lifecycle/permissions';
import { casesOut, looseInHouse } from '../shipping';
import type { AppState, Id, QtyLine, RefillTask, User } from '../types';
import { err, ok, produce, type Result } from '../util';

export { refillTasks };

/** Refill tasks with their age in days. */
export function refillTasksWithAge(
  state: AppState,
  today: IsoDate,
): (RefillTask & { ageDays: number })[] {
  return refillTasks(state).map((t) => ({
    ...t,
    ageDays: Math.max(0, diffDays(t.since, today)),
  }));
}

/**
 * Move pieces from loose stock into a case. With no `lines`, refills everything that is
 * missing as far as loose stock allows.
 */
export function refillCase(
  state: AppState,
  user: User,
  today: IsoDate,
  caseId: Id,
  lines?: QtyLine[],
): Result<AppState> {
  if (!can(user, 'refill_case') && !can(user, 'edit_catalogue'))
    return err('forbidden', 'Not allowed');
  const c = state.cases.find((x) => x.id === caseId);
  if (!c) return err('not_found', `Case ${caseId} not found`);
  if (casesOut(state).has(caseId)) return err('invalid_state', 'The case is out on an order');
  const missing = caseMissing(state, c);
  const wanted = lines ?? missing;
  const moves: QtyLine[] = [];
  for (const w of wanted) {
    const need = missing.find((m) => m.itemId === w.itemId)?.qty ?? 0;
    const qty = Math.min(w.qty, need, looseInHouse(state, w.itemId, c.warehouseId));
    if (qty > 0) moves.push({ itemId: w.itemId, qty });
  }
  if (moves.length === 0) return err('validation', 'No loose pieces available to refill this case');
  return ok(
    produce(state, (d) => {
      const x = d.cases.find((cc) => cc.id === caseId);
      if (!x) return;
      for (const m of moves) {
        const e = x.contents.find((l) => l.itemId === m.itemId);
        if (e) e.qty += m.qty;
        else x.contents.push({ ...m });
      }
      if (contentsMatchStandard(d, x)) delete x.incompleteSince;
      else x.incompleteSince = x.incompleteSince ?? today;
    }).state,
  );
}
