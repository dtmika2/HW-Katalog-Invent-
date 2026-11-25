/**
 * Seeded generator (seed 2027) → a complete `AppState` for the demo. "Today" is 2027-04-20.
 */
import {
  addDays,
  addGroup,
  emptyState,
  createLoan,
  moveToGroup,
  openServiceCase,
  runDailyJobs,
  setServiceStatus,
  unwrap,
  type AppState,
  type Case,
  type IsoDate,
  type Item,
  type ItemStock,
  type Location,
} from '@quix/core';
import { Builder, type BookingSpec, type LineSpec } from './builder';
import {
  CASE_TYPES,
  CASES,
  CATEGORIES,
  CATEGORY_SECTION,
  CLIENTS,
  CONNECTIONS,
  ITEM_ROWS,
  U,
  USERS,
  WH,
} from './catalog-data';
import { intBetween, mulberry32, pick } from './prng';

export const SEED = 2027;
export const DEMO_TODAY: IsoDate = '2027-04-20';

/** Warehouses with sections → racks → shelves (~40 locations). */
function buildLocations(): Location[] {
  const out: Location[] = [];
  const plan: [string, string, string[]][] = [
    [WH.brod, 'Brod', ['A', 'B', 'C', 'D']],
    [WH.karlak, 'Karlák', ['A', 'B']],
  ];
  for (const [wid, wname, sections] of plan) {
    const short = wid === WH.brod ? 'b' : 'k';
    for (const sec of sections) {
      const secId = `loc-${short}-${sec.toLowerCase()}`;
      out.push({
        id: secId,
        warehouseId: wid,
        name: `Sekce ${sec}`,
        path: `${wname} / Sekce ${sec}`,
      });
      for (const rack of [1, 2]) {
        const rackId = `${secId}${rack}`;
        out.push({
          id: rackId,
          warehouseId: wid,
          parentId: secId,
          name: `Regál ${rack}`,
          path: `${wname} / Sekce ${sec} / Regál ${rack}`,
        });
        for (const shelf of [1, 2]) {
          out.push({
            id: `${rackId}-${shelf}`,
            warehouseId: wid,
            parentId: rackId,
            name: `Police ${shelf}`,
            path: `${wname} / Sekce ${sec} / Regál ${rack} / Police ${shelf}`,
          });
        }
      }
    }
  }
  return out;
}

/** Shelves of a section. */
const shelvesOf = (locs: Location[], w: string, section: string) =>
  locs.filter(
    (l) =>
      l.warehouseId === w && l.path.includes(`Sekce ${section} /`) && l.name.startsWith('Police'),
  );

export function buildCatalog(rand: () => number): AppState {
  const s = emptyState();
  s.users = USERS.map((u) => ({ ...u, perms: { ...u.perms } }));
  s.warehouses = [
    { id: WH.brod, name: 'Brod' },
    { id: WH.karlak, name: 'Karlák' },
  ];
  s.locations = buildLocations();
  s.categories = CATEGORIES.map((c) => ({ ...c }));
  const topOf = (sub: string) => s.categories.find((c) => c.id === sub)?.parentId ?? sub;

  s.items = ITEM_ROWS.map(
    ([id, name, manufacturer, model, categoryId, priceDay, , , returnable, kg]) => {
      const it: Item = {
        id,
        name,
        manufacturer,
        model,
        categoryId,
        priceDay,
        returnable: returnable ?? true,
        archived: false,
      };
      if (kg !== undefined) it.weightKg = kg;
      return it;
    },
  );
  // A few items need setup (no price / notes) so the catalogue editor's completeness filter has work.
  for (const id of ['laptop-stand', 'presenter', 'cable-ramp']) {
    const it = s.items.find((i) => i.id === id);
    if (it) it.priceDay = 0;
  }
  const notes: Record<string, string> = {
    ledbeam150: 'DMX 5-pin, 15 kanálů v režimu Mode 1',
    ax9: 'Nabíjet vždy celý case, IP65',
    'dlive-s5000': 'Vyžaduje MixRack nebo stagebox po síti',
    'led-29': 'Max 8 panelů na jeden napájecí okruh',
  };
  for (const [id, n] of Object.entries(notes)) {
    const it = s.items.find((i) => i.id === id);
    if (it) it.notes = n;
  }

  s.stock = [];
  for (const [id, , , , sub, , brod, karlak] of ITEM_ROWS) {
    const sec = CATEGORY_SECTION[topOf(sub)] ?? { brod: 'A', karlak: 'A' };
    const push = (w: string, qty: number, section: string) => {
      const shelves = shelvesOf(s.locations, w, section);
      const st: ItemStock = {
        itemId: id,
        warehouseId: w,
        qty,
        homeLocationId: pick(rand, shelves).id,
      };
      s.stock.push(st);
    };
    if (brod > 0) push(WH.brod, brod, sec.brod);
    if (karlak > 0) push(WH.karlak, karlak, sec.karlak);
  }

  s.caseTypes = CASE_TYPES.map(([id, name, contents]) => ({
    id,
    name,
    contents: contents.map((c) => ({ ...c })),
  }));
  s.cases = CASES.map(([id, caseTypeId, number, w, section, missing]) => {
    const t = s.caseTypes.find((x) => x.id === caseTypeId);
    const wid = WH[w];
    const contents = (t?.contents ?? [])
      .map((c) => ({
        itemId: c.itemId,
        qty: c.qty - (missing?.find((m) => m.itemId === c.itemId)?.qty ?? 0),
      }))
      .filter((c) => c.qty > 0);
    const c: Case = {
      id,
      caseTypeId,
      number,
      warehouseId: wid,
      locationId: pick(rand, shelvesOf(s.locations, wid, section)).id,
      contents,
    };
    if (missing && missing.length > 0)
      c.incompleteSince = id === 'case-ax9-03' ? '2027-04-08' : '2027-04-15';
    return c;
  });
  s.connections = CONNECTIONS.map((c) => ({ ...c, target: { ...c.target } }));
  s.clients = CLIENTS.map((c) => ({ ...c }));
  return s;
}

const I = (
  item: string,
  qty: number,
  extra: Partial<{ from: 'brod' | 'karlak'; fromBooking: string }> = {},
): LineSpec => ({ item, qty, ...extra });
const C = (caseType: string, qty: number, from?: 'brod' | 'karlak'): LineSpec =>
  from ? { caseType, qty, from } : { caseType, qty };

/** Hand-written bookings covering every state (March–June 2027). */
export const BOOKINGS: BookingSpec[] = [
  // ---- March: closed
  {
    id: 'bk-ples',
    name: 'Jarní ples Horizont',
    pm: U.petr,
    client: 'cl-horizont',
    purpose: 'Ples pro 300 hostů, taneční parket + kapela',
    periods: [['2027-03-06', '2027-03-06']],
    stage: 'closed',
    lines: [
      I('ledbeam150', 8),
      I('par-rgbw', 12),
      I('sq6', 1),
      I('qsc-k12', 4),
      C('ct-ulxd4', 1),
      I('powercon-5', 10),
      I('dmx-5', 8),
    ],
  },
  {
    id: 'bk-fintech',
    name: 'Konference Fintech',
    pm: U.jana,
    client: 'cl-techconf',
    purpose: 'Dvoudenní konference, 1 sál, projekce',
    periods: [['2027-03-11', '2027-03-12']],
    stage: 'closed',
    lines: [
      I('x32', 1),
      I('qsc-k12', 2),
      I('epson-l1505', 1),
      I('screen-5m', 1),
      C('ct-ulxd4', 1),
      I('lectern', 1),
    ],
  },
  {
    id: 'bk-zajezd',
    name: 'Divadlo Na Kraji – zájezd',
    pm: U.lucie,
    client: 'cl-divadlo',
    purpose: 'Stejná sestava tři víkendy po sobě',
    periods: [
      ['2027-03-13', '2027-03-14'],
      ['2027-03-20', '2027-03-21'],
      ['2027-03-27', '2027-03-28'],
    ],
    warehouse: 'karlak',
    stage: 'closed',
    lines: [
      I('par-rgbw', 8),
      I('chamsys-mq80', 1),
      I('qsc-k12', 2),
      I('x32', 1),
      I('powercon-5', 8),
      I('dmx-5', 8),
    ],
  },
  {
    id: 'bk-autosalon',
    name: 'Autosalon Morava – představení modelu',
    pm: U.petr,
    client: 'cl-morava',
    purpose: 'LED stěna 4×2 m za autem, AX1 tuby',
    periods: [['2027-03-19', '2027-03-20']],
    stage: 'closed',
    lines: [C('ct-led29', 2), C('ct-ax1', 2), C('ct-rogue2', 2), I('powercon-5', 6)],
  },
  // ---- April: past and current
  {
    id: 'bk-lednice-dod',
    name: 'Pivovar Lednice – den otevřených dveří',
    pm: U.jana,
    client: 'cl-lednice',
    purpose: 'Venkovní stage, 2 kapely',
    periods: [['2027-04-03', '2027-04-04']],
    stage: 'returned_with_issues',
    lines: [
      I('qsc-k12', 4),
      I('sm58', 6),
      I('par-rgbw', 8),
      I('gaffer-black', 2),
      I('schuko-10', 6),
    ],
    returns: { sm58: { returned: 5, note: 'Jeden SM58 se po akci nenašel' } },
  },
  {
    id: 'bk-benefice',
    name: 'Benefice Dobrý start',
    pm: U.lucie,
    client: 'cl-dobrystart',
    purpose: 'Večer pro dárce, 120 lidí',
    periods: [['2027-04-09', '2027-04-10']],
    stage: 'returned',
    lines: [C('ct-ledbeam4', 2), I('sq5', 1), C('ct-e8pair', 2), I('powercon-5', 8)],
  },
  {
    id: 'bk-spektrum-vecirek',
    name: 'Firemní večírek Spektrum',
    pm: U.petr,
    client: 'cl-spektrum',
    purpose: 'Večírek, zatím jen poptávka',
    periods: [['2027-04-12', '2027-04-12']],
    stage: 'expired',
    lines: [I('par-rgbw', 8), I('qsc-k12', 2)],
  },
  {
    id: 'bk-vernisaz',
    name: 'Vernisáž v galerii',
    pm: U.lucie,
    client: 'cl-divadlo',
    purpose: 'Komorní akce, ozvučení řeči',
    periods: [['2027-04-16', '2027-04-16']],
    stage: 'expired',
    lines: [I('qsc-k12', 2), C('ct-ulxd4', 1)],
  },
  {
    id: 'bk-roadshow',
    name: 'Autosalon Morava – roadshow Brno',
    pm: U.petr,
    client: 'cl-morava',
    purpose: 'Stánek na výstavišti, část techniky z Karláku',
    periods: [['2027-04-15', '2027-04-18']],
    stage: 'returning',
    lines: [
      I('tv-65', 2, { from: 'karlak' }),
      I('qsc-k12', 2, { from: 'karlak' }),
      I('par-rgbw', 6),
      I('walkie', 4),
    ],
    returnedFirst: ['par-rgbw', 'walkie'],
  },
  {
    id: 'bk-techconf',
    name: 'TechConf 2027',
    pm: U.jana,
    client: 'cl-techconf',
    purpose: 'Hlavní sál + 2 breakouty, stream',
    periods: [['2027-04-18', '2027-04-20']],
    stage: 'shipped',
    secondBatch: ['epson-l1505'],
    lines: [
      I('ledbeam150', 8),
      I('epson-l1505', 2),
      I('sq6', 1),
      C('ct-stagebox', 1),
      C('ct-ulxd4', 2),
      C('ct-led29', 1),
      I('ptz-ue150', 2),
      I('atem-mini', 1),
      I('powercon-5', 12),
      I('dmx-5', 6),
    ],
    messages: [[U.jana, 'Klient chce stream do dvou breakoutů, kamery prosím s SDI.']],
  },
  // ---- Upcoming
  {
    id: 'bk-letni-warmup',
    name: 'Letní noc – warm-up',
    pm: U.lucie,
    client: 'cl-letni',
    purpose: 'Klubový warm-up, LEDBeamy přejedou rovnou z TechConfu',
    periods: [['2027-04-23', '2027-04-24']],
    stage: 'packing',
    lines: [
      I('ledbeam150', 8, { fromBooking: 'bk-techconf' }),
      C('ct-rogue2', 2),
      I('x32', 1),
      I('qsc-ks118', 2),
      I('qsc-k12', 2),
      I('powercon-5', 6),
      I('dmx-5', 6),
      {
        external: {
          name: 'Hazer Unique 2.1',
          supplier: 'Stage Rent s.r.o.',
          note: 'Vlastní hazery jsou na Firemním dni',
        },
        qty: 1,
      },
    ],
  },
  {
    id: 'bk-firemni',
    name: 'Firemní den',
    pm: U.jana,
    client: 'cl-horizont',
    purpose: 'Firemní den v areálu banky, venkovní osvětlení AX9',
    periods: [['2027-04-24', '2027-04-24']],
    stage: 'confirmed',
    lines: [C('ct-ax9', 1), I('par-rgbw', 6), I('qsc-k12', 2), I('hazer', 1)],
  },
  {
    id: 'bk-svatba',
    name: 'Hotel Grand – svatba',
    pm: U.petr,
    client: 'cl-grand',
    purpose: 'Svatba v zahradě hotelu, 150 hostů',
    periods: [['2027-04-25', '2027-04-25']],
    stage: 'confirmed',
    lines: [C('ct-ax1', 1), I('x32', 1), I('qsc-k12', 2), I('sm58', 2), I('powercon-schuko', 4)],
  },
  {
    id: 'bk-carodejnice',
    name: 'Čarodějnice Brod',
    pm: U.lucie,
    client: 'cl-brod',
    purpose: 'Městská akce na náměstí, pódium 8×6 m',
    periods: [['2027-04-30', '2027-04-30']],
    stage: 'confirmed',
    lines: [
      I('stage-deck', 12),
      I('qsc-k12', 4),
      I('qsc-ks118', 2),
      I('par-rgbw', 12),
      I('distro-32', 1),
      I('gaffer-black', 3),
      { external: { name: 'Pódiová střecha 8×6 m', supplier: 'Stage Rent s.r.o.' }, qty: 1 },
    ],
  },
  {
    id: 'bk-muzikal',
    name: 'Muzikál – víkendová představení',
    pm: U.lucie,
    client: 'cl-divadlo',
    purpose: 'Tři víkendy se stejnou technikou',
    periods: [
      ['2027-05-08', '2027-05-09'],
      ['2027-05-22', '2027-05-23'],
      ['2027-06-05', '2027-06-06'],
    ],
    stage: 'confirmed',
    lines: [
      I('par-rgbw', 12),
      C('ct-rogue2', 2),
      I('x32', 1),
      C('ct-ulxd4', 1),
      I('powercon-5', 8),
      I('dmx-5', 8),
    ],
  },
  {
    id: 'bk-kveten',
    name: 'Květnový festival',
    pm: U.jana,
    client: 'cl-letni',
    purpose: 'Open-air, hlavní stage + AX9 na stromy',
    periods: [['2027-05-15', '2027-05-16']],
    stage: 'confirmed',
    lines: [
      C('ct-ax9', 2),
      C('ct-ledbeam4', 2),
      I('megapointe', 6),
      I('db-y10p', 8),
      I('db-b6-sub', 4),
      I('db-d20', 3),
      I('dlive-s5000', 1),
      C('ct-stagebox', 2),
      I('powercon-5', 20),
      I('dmx-10', 12),
    ],
  },
  {
    id: 'bk-valna',
    name: 'Valná hromada Horizont',
    pm: U.petr,
    client: 'cl-horizont',
    purpose: 'Formální akce, projekce a řečnický pult',
    periods: [['2027-05-20', '2027-05-20']],
    stage: 'submitted',
    lines: [
      I('epson-l1505', 2),
      I('screen-5m', 1),
      I('lectern', 1),
      C('ct-ulxd4', 1),
      I('qsc-k12', 4),
    ],
  },
  {
    id: 'bk-zdravi',
    name: 'Konference Zdraví',
    pm: U.jana,
    client: 'cl-techconf',
    purpose: 'Poptávka, čekáme na program',
    periods: [['2027-05-26', '2027-05-27']],
    stage: 'submitted',
    lines: [
      I('epson-l1075', 2),
      I('screen-3m', 2),
      I('x32', 1),
      I('qsc-k12', 2),
      I('ulxd2-b58', 4),
      I('ulxd4q', 1),
    ],
  },
  {
    id: 'bk-teambuilding',
    name: 'Teambuilding Spektrum',
    pm: U.petr,
    client: 'cl-spektrum',
    purpose: 'Rozpracováno — upřesní počet lidí',
    periods: [['2027-05-29', '2027-05-29']],
    stage: 'draft',
    lines: [I('qsc-k12', 2), I('par-rgbw', 6)],
  },
  {
    id: 'bk-grand-vecer',
    name: 'Hotel Grand – firemní večer',
    pm: U.jana,
    client: 'cl-grand',
    purpose: 'Rozpracováno',
    periods: [['2027-06-12', '2027-06-12']],
    stage: 'draft',
    lines: [C('ct-ax1', 2), I('x32', 1)],
  },
  {
    id: 'bk-letni-noc',
    name: 'Festival Letní noc',
    pm: U.lucie,
    client: 'cl-letni',
    purpose: 'Hlavní festival, LED stěna outdoor, rigging',
    periods: [['2027-06-19', '2027-06-21']],
    stage: 'confirmed',
    lines: [
      I('led-39-out', 24),
      I('hoist-500', 4),
      I('truss-3m', 12),
      I('megapointe', 6),
      I('db-y10p', 8),
      I('db-b6-sub', 4),
      I('db-d20', 3),
      I('digico-sd12', 1),
      I('distro-63', 1),
      I('powercon-5', 20),
    ],
  },
  {
    id: 'bk-den-mesta',
    name: 'Den města Brod',
    pm: U.petr,
    client: 'cl-brod',
    purpose: 'Odpolední program na náměstí',
    periods: [['2027-06-27', '2027-06-27']],
    stage: 'submitted',
    lines: [I('stage-deck', 8), I('qsc-k12', 4), I('x32', 1), I('par-rgbw', 8)],
  },
  {
    id: 'bk-slavnosti',
    name: 'Lednice pivní slavnosti',
    pm: U.lucie,
    client: 'cl-lednice',
    purpose: 'Dvoudenní slavnosti, LED obrazovka externě',
    periods: [['2027-06-25', '2027-06-26']],
    stage: 'confirmed',
    warehouse: 'karlak',
    lines: [
      I('qsc-k12', 4),
      I('qsc-ks118', 2),
      I('x32', 1),
      I('par-rgbw', 12),
      {
        external: {
          name: 'Mobilní LED obrazovka 4×3 m',
          supplier: 'LED Rent CZ',
          note: 'Vč. technika',
        },
        qty: 1,
      },
    ],
  },
];

/** Small items used by the PRNG filler bookings (no LEDBeams, cases or AX9 so scenarios stay exact). */
const FILLER_POOL: [string, number][] = [
  ['qsc-k12', 2],
  ['sm58', 4],
  ['par-rgbw', 6],
  ['x32', 1],
  ['epson-l1075', 1],
  ['tv-65', 1],
  ['walkie', 4],
  ['lectern', 1],
  ['blinder', 4],
  ['mic-stand', 4],
  ['monitor-24', 2],
  ['clickshare', 1],
  ['intercom-belt', 2],
];
const FILLER_NAMES = [
  'Školení',
  'Tisková konference',
  'Narozeninová oslava',
  'Křest knihy',
  'Firemní snídaně',
  'Seminář',
  'Charitativní běh',
  'Prezentace produktu',
];

function fillerBookings(rand: () => number): BookingSpec[] {
  const out: BookingSpec[] = [];
  const pms = [U.petr, U.lucie, U.jana];
  const clients = CLIENTS.map((c) => c.id);
  // dates spread over March–June, avoiding the June 7–13 conflict-chain week
  const days = [
    '2027-03-03',
    '2027-03-17',
    '2027-03-24',
    '2027-04-07',
    '2027-05-05',
    '2027-05-12',
    '2027-06-02',
    '2027-06-16',
  ];
  days.forEach((d, i) => {
    const n = intBetween(rand, 2, 3);
    const lines: LineSpec[] = [];
    const used = new Set<string>();
    while (lines.length < n) {
      const [item, qty] = pick(rand, FILLER_POOL);
      if (used.has(item)) continue;
      used.add(item);
      lines.push(I(item, qty));
    }
    const past = d < DEMO_TODAY;
    const stage = past ? 'closed' : i % 2 === 0 ? 'confirmed' : 'submitted';
    out.push({
      id: `bk-fill-${i + 1}`,
      name: `${pick(rand, FILLER_NAMES)} ${pick(rand, CLIENTS).name.split(' ')[0]}`,
      pm: pick(rand, pms),
      client: pick(rand, clients),
      purpose: '',
      periods: [[d, d]],
      stage,
      lines,
    });
  });
  return out;
}

/** Service cases in different states (one overdue on DEMO_TODAY). */
function addServiceCases(b: Builder): void {
  const karel = b.user(U.karel);
  const martin = b.user(U.martin);
  const tomas = b.user(U.tomas);
  const open = (day: IsoDate, input: Parameters<typeof openServiceCase>[3]) => {
    const r = unwrap(openServiceCase(b.state, martin, day, input));
    b.state = r.state;
    return r.serviceCaseId;
  };
  const status = (
    id: string,
    day: IsoDate,
    st: Parameters<typeof setServiceStatus>[4],
    comment?: string,
    extra: object = {},
  ) => {
    b.state = unwrap(
      setServiceStatus(b.state, karel, day, id, st, { ...(comment ? { comment } : {}), ...extra }),
    );
  };
  // 1) Fixed in March (history)
  const h = open('2027-03-02', {
    itemId: 'hazer',
    warehouseId: WH.brod,
    qty: 1,
    reason: 'Netopí, chyba čerpadla',
    responsibleUserId: U.karel,
    expectedBack: '2027-03-10',
  });
  status(h, '2027-03-04', 'in_progress', 'Vyměněno čerpadlo');
  status(h, '2027-03-09', 'fixed', 'Otestováno 2 h, funguje');
  // 2) Rogue in repair in-house
  const r = open('2027-04-14', {
    itemId: 'rogue-r2',
    warehouseId: WH.brod,
    qty: 1,
    reason: 'Nefunguje zoom',
    responsibleUserId: U.karel,
    expectedBack: '2027-04-25',
  });
  status(r, '2027-04-15', 'in_progress', 'Rozebráno, motor zoomu');
  // 3) Projector at external service — overdue
  const p = open('2027-04-01', {
    itemId: 'epson-l1075',
    warehouseId: WH.karlak,
    qty: 1,
    reason: 'Chyba lampy/laseru, bliká LED',
    internal: false,
    repairShop: 'Epson servis Praha',
    responsibleUserId: U.tomas,
    expectedBack: '2027-04-15',
  });
  b.state = unwrap(
    setServiceStatus(b.state, tomas, '2027-04-02', p, 'external', {
      comment: 'Odvezeno do servisu',
    }),
  );
  // 4) Wireless mic waiting for parts
  const m = open('2027-04-11', {
    itemId: 'ulxd2-b58',
    warehouseId: WH.brod,
    qty: 1,
    reason: 'Prasklá mřížka, nejde zapnout',
    responsibleUserId: U.karel,
    expectedBack: '2027-05-05',
  });
  status(m, '2027-04-12', 'waiting_parts', 'Objednána mřížka a vypínač');
  // 5) Speaker back from repair, waiting for check
  const sp = open('2027-04-05', {
    itemId: 'db-e12',
    warehouseId: WH.brod,
    qty: 1,
    reason: 'Chrčí výšky',
    internal: false,
    repairShop: 'Audio servis Brno',
    responsibleUserId: U.karel,
    expectedBack: '2027-04-22',
  });
  status(sp, '2027-04-06', 'external');
  status(sp, '2027-04-18', 'back_to_check', 'Vyměněn driver, otestovat');
}

/** Quick loans: one running, one overdue, one for somebody outside without a return date. */
function addLoans(b: Builder): void {
  const take = (userId: string, day: IsoDate, input: Parameters<typeof createLoan>[3]) => {
    b.state = unwrap(createLoan(b.state, b.user(userId), day, input)).state;
  };
  take(U.lucie, '2027-04-12', {
    itemId: 'monitor-24',
    warehouseId: WH.karlak,
    qty: 1,
    until: '2027-04-16',
    note: 'Náhradní monitor do kanceláře',
  });
  take(U.karel, '2027-04-17', {
    itemId: 'lectern',
    warehouseId: WH.karlak,
    qty: 1,
    borrowerName: 'Základní škola Brod',
    note: 'Školní akademie',
  });
  take(U.petr, '2027-04-19', {
    itemId: 'walkie',
    warehouseId: WH.brod,
    qty: 2,
    until: '2027-04-22',
    note: 'Obhlídka v terénu',
  });
}

/** The festival's list organised by its PM into groups. */
function addGroups(b: Builder): void {
  const of: [string, string[]][] = [
    ['LED stěna', ['led-39-out']],
    ['Ozvučení', ['db-y10p', 'db-b6-sub', 'db-d20', 'digico-sd12']],
    ['Světla a rigging', ['megapointe', 'truss-3m', 'hoist-500']],
  ];
  b.state = {
    ...b.state,
    bookings: b.state.bookings.map((x) => {
      if (x.id !== 'bk-letni-noc') return x;
      let booking = x;
      for (const [name, items] of of) {
        const r = addGroup(booking, name);
        booking = r.booking;
        for (const l of booking.lines)
          if ('itemId' in l.target && items.includes(l.target.itemId))
            booking = moveToGroup(booking, l.id, r.groupId);
      }
      return booking;
    }),
  };
}

/** The full demo state (deterministic). */
export function generateState(today: IsoDate = DEMO_TODAY): AppState {
  const rand = mulberry32(SEED);
  const base = buildCatalog(rand);
  const b = new Builder(base, today);
  const specs = [...BOOKINGS, ...fillerBookings(rand)].sort((x, y) =>
    x.periods[0]![0] < y.periods[0]![0] ? -1 : 1,
  );
  // Service cases opened early in April must exist before April bookings are confirmed.
  let serviceDone = false;
  for (const spec of specs) {
    if (!serviceDone && spec.periods[0]![0] >= '2027-04-15') {
      addServiceCases(b);
      serviceDone = true;
    }
    b.book(spec);
  }
  if (!serviceDone) addServiceCases(b);
  addLoans(b);
  addGroups(b);

  // Tonight's job for the demo bell; older notifications count as read.
  const jobbed = runDailyJobs(b.state, today).state;
  const yesterday = addDays(today, -1);
  return {
    ...jobbed,
    notifications: jobbed.notifications.map((n) => (n.on <= yesterday ? { ...n, read: true } : n)),
  };
}
