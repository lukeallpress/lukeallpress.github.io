/**
 * Affordability: can this house be carried, and what has to change?
 *
 * The honest version of this question is not "what is the mortgage payment" but
 * "what is left after the mortgage and everything else that already happens".
 * So the baseline here is measured, not budgeted: what the household actually
 * spent over the last twelve months, with the old housing cost stripped out and
 * the new one put in its place.
 *
 * Two adjustments matter and are easy to miss:
 *
 *  - Take-home overstates sustainable income while one paycheque withholds no
 *    federal tax. That money is owed, it just has not been collected yet, so it
 *    is subtracted here rather than being allowed to look like income.
 *  - Money moved into investments is not spending, but in a deficit it is not
 *    saving either — it is the house proceeds being recycled. It is shown as its
 *    own line so it can be seen for what it is.
 */

const round = (n, p = 0) => Math.round(n * 10 ** p) / 10 ** p;

/** Categories a household can move on quickly, in the order it usually does. */
const FLEXIBILITY = {
  'Dining & Drinks': { flex: 0.5, note: 'Mostly small fast-food runs rather than occasions' },
  Shopping: { flex: 0.35, note: 'Amazon, Apple and Target make up most of it' },
  Travel: { flex: 0.5, note: 'Lumpy, and the most deferrable line here' },
  Entertainment: { flex: 0.4, note: 'Tickets, events, streaming' },
  Groceries: { flex: 0.12, note: 'Real room exists but it is slow and unpleasant work' },
  'Personal Care': { flex: 0.35, note: '' },
  Gifts: { flex: 0.3, note: '' },
  'Auto & Transport': { flex: 0.15, note: 'Fuel and insurance are close to fixed' },
  Kids: { flex: 0.05, note: 'Almost entirely school and childcare' },
  Utilities: { flex: 0.05, note: 'And likely to rise: bigger house, plus a pool' },
  Health: { flex: 0, note: '' },
  Taxes: { flex: 0, note: '' },
  'Charity & Donations': { flex: 0.5, note: 'A values call, not a maths one' },
};

/** Housing lines in the old ledger that the new mortgage replaces. */
const OLD_HOUSING = /nova|home loans|solare ranch|service\* general buye/i;

/** Categories whose spending since the contract date is move-in, not ongoing. */
const SETUP_CATEGORIES = new Set([
  'Home:Home Improvement', 'Home:Furnishings', 'Home:Home Services', 'Home:Pool',
]);

export function affordability(config, payload, transactions, catRollup) {
  const H = payload.headline;
  const m = config.mortgage;
  const bd = m.buydown;
  const pay = payload.paycheck.household;
  const tax = payload.paycheck.tax;
  const t12 = new Set(payload.meta.t12);

  // Baseline: what was actually spent, minus the housing it no longer pays for,
  // and minus the move-in spending that will not repeat.
  let oldHousing = 0;
  let setup = 0;
  const contractDate = config.realEstate[0].contractDate;
  const byCategory = new Map();
  for (const t of transactions) {
    if (t.flow !== 'expense') continue;
    if (!t12.has(t.date.slice(0, 7))) continue;
    const amt = -t.amount;
    if (t.category === 'Home:Mortgage' || t.category === 'Home:HOA Dues'
      || OLD_HOUSING.test(t.rawPayee ?? t.payee)) {
      oldHousing += amt;
      continue;
    }
    if (SETUP_CATEGORIES.has(t.category) && t.date >= contractDate) {
      setup += amt;
      continue;
    }
    const top = (t.category || 'Uncategorized').split(':')[0];
    byCategory.set(top, (byCategory.get(top) ?? 0) + amt);
  }

  // Costs the house will carry that the last twelve months never saw — pool
  // service and pest control were set up after the move, so the measured
  // baseline understates what the house actually costs to run.
  const planned = payload.commitments?.planned ?? [];
  const plannedMonthly = round(planned.reduce((s2, x) => s2 + x.monthly, 0));
  const measuredBaseline = round([...byCategory.values()].reduce((s2, v) => s2 + v, 0) / 12);
  const baseline = round(measuredBaseline + plannedMonthly);
  const setupMonthly = round(setup / 12);
  const oldHousingMonthly = round(oldHousing / 12);

  // Standing savings transfers are cash leaving the account. They are not
  // spending, so they sit below the operating line — but they are not free
  // either, and the earlier version of this model left them out entirely and
  // then offered "stop investing" as a way to close a gap that had never
  // included them. That double-counted. Both lines are shown now.
  const monthly = payload.monthlyOrdinary ?? [];
  const recent3 = payload.meta.t12.slice(-3);
  const savingsObserved = round(
    monthly.filter((x) => recent3.includes(x.month))
      .reduce((s, x) => s + x.savings, 0) / 3,
  );
  // Prefer the stated standing orders over the observed three-month average.
  // The observed figure is noisy right now — July shows a net *inflow* because
  // of the Wealthfront liquidation — whereas the standing orders are what will
  // actually leave next month, which is the number a forecast needs.
  const stated = payload.commitments?.groups?.find((g) => g.key === 'savings');
  const savingsNow = stated ? round(stated.monthly) : savingsObserved;
  const savingsTrailing = round(H.avgSavings);

  const housingNow = round(bd.borrowerPI + m.escrow.totalMonthly);
  const housingLater = round(
    m.monthlyPI + m.escrow.totalMonthly + payload.house.taxCheck.escrowGap,
  );

  // Income, adjusted for tax that is owed but not being withheld.
  const takeHome = round(pay.monthlyNet);
  const withholdingShortfall = tax && tax.totalGap > 0 ? round(tax.totalGap / 12) : 0;
  const sustainableIncome = round(takeHome - withholdingShortfall);

  const scenarios = [
    {
      key: 'now', label: 'Today',
      housing: housingNow,
      note: `While the lender's buydown holds the payment at ${bd.borrowerPI.toFixed(2)}`,
    },
    {
      key: 'buydown', label: 'From Sep 2027',
      housing: round(m.monthlyPI + m.escrow.totalMonthly),
      note: 'Buydown expires; the note rate applies in full',
    },
    {
      key: 'reassessed', label: 'After reassessment too',
      housing: housingLater,
      note: 'Escrow catches up with the post-sale tax bill',
    },
  ].map((s) => ({
    ...s,
    baseline,
    income: sustainableIncome,
    // The operating gap: income against housing and living costs, before any
    // saving. This is what has to close for the house to be carried on income
    // rather than on the proceeds of selling the last one.
    surplus: round(sustainableIncome - s.housing - baseline),
    netCash: round(sustainableIncome - s.housing - baseline - savingsNow),
    housingShare: round((s.housing / sustainableIncome) * 100, 1),
  }));

  const gap = -scenarios[2].surplus;
  const gapNow = -scenarios[0].surplus;

  // Two different kinds of move, and conflating them is how the first version of
  // this model went wrong. Stopping a savings transfer keeps cash in the account
  // but does nothing to the operating gap — it buys time. Only spending cuts (or
  // more income) actually close it.
  const timeBuyers = [];
  if (savingsNow > 25) {
    timeBuyers.push({
      name: 'Stop the remaining standing transfers',
      monthly: savingsNow,
      note: `Down from ${money(savingsTrailing)}/mo over the last year — most of that `
        + 'reduction has already been made. What is left keeps cash in the account but does '
        + 'not narrow the gap between income and spending.',
    });
  }

  const levers = [];
  for (const c of catRollup) {
    const f = FLEXIBILITY[c.name];
    if (!f || f.flex <= 0) continue;
    const value = round(c.avgMonth * f.flex);
    if (value < 25) continue;
    levers.push({
      name: `Trim ${c.name} by ${Math.round(f.flex * 100)}%`,
      monthly: value,
      kind: 'spending',
      from: round(c.avgMonth),
      to: round(c.avgMonth * (1 - f.flex)),
      note: f.note,
    });
  }
  levers.sort((a, b) => b.monthly - a.monthly);

  let running = 0;
  for (const l of levers) {
    running += l.monthly;
    l.cumulative = round(running);
    l.closesGap = running >= gapNow;
  }
  const maxTrim = round(running);
  const enough = levers.findIndex((l) => l.closesGap);

  // The honest bottom line: trim everything that can plausibly be trimmed, and
  // see what is left.
  const afterMaxTrimNow = round(scenarios[0].surplus + maxTrim);
  const afterMaxTrimLater = round(scenarios[2].surplus + maxTrim);

  // How long the liquid assets absorb the shortfall if nothing changes.
  const burn = Math.max(1, -scenarios[0].netCash);
  const runwayMonths = round(H.cashAvailable / burn, 1);
  const runwayWithInvestments = round((H.cashAvailable + H.investTotal) / burn, 1);

  const cuttable = (payload.recurring ?? [])
    .filter((r) => r.status === 'active' && r.kind === 'fixed')
    .filter((r) => !/utilit|electric|gas|water|trash|internet|insurance|liberty|aps|parks|centurylink|starlink/i
      .test(`${r.label} ${r.category}`))
    .map((r) => ({ ...r, monthly: round(r.annual / 12, 2) }))
    .sort((a, b) => b.annual - a.annual);

  return {
    baseline,
    measuredBaseline,
    plannedMonthly,
    planned,
    setupMonthly,
    oldHousingMonthly,
    housingNow,
    housingLater,
    housingIncrease: round(housingNow - oldHousingMonthly),
    housingIncreaseLater: round(housingLater - oldHousingMonthly),
    takeHome,
    withholdingShortfall,
    sustainableIncome,
    savingsNow,
    savingsTrailing,
    savingsReduced: round(savingsTrailing - savingsNow),
    scenarios,
    gap,
    gapNow,
    timeBuyers,
    levers,
    maxTrim,
    leversNeeded: enough === -1 ? levers.length : enough + 1,
    coverable: enough !== -1,
    afterMaxTrimNow,
    afterMaxTrimLater,
    runwayMonths,
    runwayWithInvestments,
    cuttable,
    cuttableAnnual: round(cuttable.reduce((s, r) => s + r.annual, 0)),
    categories: [...byCategory.entries()]
      .map(([name, total]) => ({
        name,
        monthly: round(total / 12),
        flex: FLEXIBILITY[name]?.flex ?? 0,
        trimmable: round((total / 12) * (FLEXIBILITY[name]?.flex ?? 0)),
      }))
      .sort((a, b) => b.monthly - a.monthly),
  };
}

const money = (n) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
