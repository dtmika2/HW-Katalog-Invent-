/**
 * Prints the gamification calibration report (G3) for the demo data.
 *
 *   npm run xp-report              — the base demo state
 *   XP_ALL=1 npm run xp-report     — every scenario
 */
import { RULES } from '@quix/core';
import { calibrate, DEMO_TODAY, SCENARIOS, type XpReport } from '@quix/fixtures';

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const rpad = (s: string | number, n: number) => String(s).padStart(n);
const pct = (x: number) => `${(x * 100).toFixed(0)} %`;

function people(r: XpReport): void {
  console.log('Person              role         XP  top rule (besides core)        talk');
  for (const p of r.people)
    console.log(
      `${pad(p.name, 18)}  ${pad(p.role, 9)} ${rpad(p.total, 6)}  ${pad(`${p.topRule.ruleId} ${pct(p.topRule.share)}`, 30)} ${rpad(pct(p.talkShare), 5)}`,
    );
}

function print(id: string): void {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) return;
  const { demo, talkative, checks } = calibrate(sc.build(), DEMO_TODAY);
  console.log(`\n=== ${id} — ${demo.months.toFixed(1)} months of history ===\n`);
  people(demo);
  console.log('\nRole       active   XP total   XP/person/month');
  for (const x of demo.roles)
    console.log(
      `${pad(x.role, 10)} ${rpad(x.people, 6)} ${rpad(x.total, 10)} ${rpad(x.perPersonMonth.toFixed(0), 17)}`,
    );
  console.log('\nTop rules');
  for (const x of demo.rules.slice(0, 12))
    console.log(
      `${pad(x.ruleId, 26)} ${rpad(x.points, 6)}  ${rpad((x.share * 100).toFixed(1), 5)} %  (${RULES[x.ruleId].category})`,
    );
  console.log('\nTalkative team (communication added, see withTypicalTalk)\n');
  people(talkative);
  console.log('\nChecks');
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name} — ${c.detail}`);
}

const ids = process.env.XP_ALL ? SCENARIOS.map((s) => s.id) : ['base'];
for (const id of ids) print(id);
