/**
 * Old house against new, line by line.
 *
 * The headline everyone reaches for is the mortgage, but the mortgage is only
 * part of what changed, and the second-largest line is easy to read wrong.
 *
 * Electricity went from $92 a month to $389. That looks like the new house
 * being expensive, and partly it is — it is bigger and it has a pool pump. But
 * the old house had solar panels, and the $250/mo loan paying for them sits in
 * a different row entirely. Compared honestly, the old address cost $342 a
 * month for energy and the new one costs less than that once the summer peak is
 * taken out. The two rows are paired here so they cannot be read separately.
 *
 * The other caveat is carried in the output rather than buried: the new-house
 * window is seven weeks of Phoenix July and August, the worst possible sample
 * for a bill dominated by air conditioning. The measured figure is a summer
 * peak, flagged as one, with the annual estimate derived separately.
 */

const round = (n, p = 0) => Math.round(n * 10 ** p) / 10 ** p;
const DAY = 86400000;
const months = (a, b) => Math.max(0.5, (Date.parse(b) - Date.parse(a)) / DAY / 30.44);

/**
 * Peak-summer months carry far more cooling load than the rest of the year, so
 * a two-month sample taken in July and August overstates the annual average.
 * Phoenix cooling degree days put July/August at roughly 1.9x the annual mean
 * for a household bill dominated by air conditioning.
 */
const SUMMER_PEAK_FACTOR = 1.9;

const LINES = [
  { key: 'pi', label: 'Mortgage — principal & interest', kind: 'housing' },
  { key: 'escrow', label: 'Mortgage — escrow', kind: 'housing' },
  { key: 'hoa', label: 'HOA dues', kind: 'housing', match: /solare ranch/i },
  // Paired: the old house's electricity bill was low *because* of the panels the
  // solar loan was buying. Reading either row alone gives the wrong answer.
  {
    key: 'solar', label: 'Solar panel loan', kind: 'energy', match: /tech cu/i,
    pairedWith: 'electric',
  },
  {
    key: 'electric', label: 'Electricity', kind: 'energy', match: /aps electric/i,
    seasonal: true, pairedWith: 'solar',
  },
  { key: 'gas', label: 'Gas', kind: 'utility', match: /southwest gas/i },
  { key: 'water', label: 'Water and sewer', kind: 'utility', match: /valley utilities|liberty utilitie|epcor/i },
  { key: 'trash', label: 'Trash', kind: 'utility', match: /parks and sons/i },
  { key: 'internet', label: 'Internet', kind: 'utility', match: /centurylink|starlink/i },
  { key: 'pool', label: 'Pool service', kind: 'service', match: /cowabunga/i, statedNew: 'Pool service' },
  { key: 'pest', label: 'Pest control', kind: 'service', match: /deal pest|aptive/i, statedNew: 'Pest control' },
];

export function houseCompare(config, payload, transactions) {
  const re = config.realEstate[0];
  const sold = config.soldHome;
  const m = config.mortgage;
  const bd = m.buydown;
  const asOf = config.asOf;

  const moveIn = re.closedOn;
  const oldFrom = payload.meta.t12[0] ? `${payload.meta.t12[0]}-01` : '2025-07-01';
  const oldMonths = months(oldFrom, moveIn);
  const newMonths = months(moveIn, asOf);

  /**
   * What a charge actually costs per month, over the span it was actually live.
   *
   * Neither obvious method works alone. Dividing by the whole window understates
   * anything that started or stopped inside it — the old mortgage ran at
   * $1,654.81 but ended when the house was listed, so a twelve-month average
   * reports $1,453, a payment never made. Taking the median month instead breaks
   * on anything that is not monthly: trash is billed quarterly at $111.15, and
   * the median of its active months reports $111 a month rather than $37.
   *
   * So: total over the span from first charge to last, divided by the length of
   * that span. Cadence and start/stop both come out right.
   */
  const perMonth = (match, from, to, cadenceHint = null) => {
    if (!match) return 0;
    const hits = [];
    for (const t of transactions) {
      if (t.flow !== 'expense' && t.flow !== 'savings') continue;
      if (t.date < from || t.date >= to) continue;
      if (!match.test(t.rawPayee ?? t.payee)) continue;
      hits.push(t);
    }
    if (!hits.length) return { monthly: 0, charges: 0, gapDays: null };
    hits.sort((a, b) => (a.date < b.date ? -1 : 1));
    const total = hits.reduce((s2, t) => s2 + -t.amount, 0);

    // One or two charges cannot establish a cadence. The new-house window is
    // seven weeks long, so a quarterly trash bill appears once in it and would
    // otherwise read as $111 a month rather than $37. Where the caller knows the
    // cadence from the other side of the move, it is passed in and used.
    if (hits.length === 1) {
      const period = cadenceHint ? cadenceHint / 30.44 : 1;
      return { monthly: total / Math.max(1, period), charges: 1, gapDays: null, thin: true };
    }

    // Span the billing period the last charge covers, not just to its date —
    // otherwise two quarterly bills look like two months of cost.
    const gapDays = (Date.parse(hits[hits.length - 1].date) - Date.parse(hits[0].date))
      / DAY / (hits.length - 1);
    const spanMonths = Math.max(
      1,
      ((Date.parse(hits[hits.length - 1].date) - Date.parse(hits[0].date)) / DAY + gapDays) / 30.44,
    );
    return { monthly: total / spanMonths, charges: hits.length, gapDays, thin: hits.length < 3 };
  };

  const statedPlanned = new Map(
    (config.commitments?.planned ?? []).map((x) => [x.name.split(' —')[0], x.monthly]),
  );
  // Charges that have ended for good. The ledger still shows them inside the
  // new-house window — the solar loan was cleared on 27 Aug, three weeks after
  // the move — so the measured figure would imply an ongoing cost.
  const endedMatchers = (config.commitments?.ended ?? [])
    .filter((x) => x.payeeMatch)
    .map((x) => ({
      key: LINES.find((l) => l.match && x.payeeMatch
        && l.match.test(x.payeeMatch.replace(/\\/g, '')))?.key,
      was: x.was,
      note: x.note,
    }))
    .filter((x) => x.key);

  const rows = LINES.map((line) => {
    let before = 0;
    let after = 0;
    let note = null;
    let estimate = false;
    let thin = false;

    if (line.key === 'pi') {
      // The old payment was one all-in figure; the new one splits P&I from escrow.
      before = round(perMonth(/nova/i, oldFrom, moveIn).monthly);
      after = round(bd.borrowerPI);
      note = 'Old payment was all-in; the new one splits principal and interest from escrow';
    } else if (line.key === 'escrow') {
      before = 0;
      after = round(m.escrow.totalMonthly);
      note = 'Included in the old all-in payment above';
    } else if (endedMatchers.some((e) => e.key === line.key)) {
      const e = endedMatchers.find((x) => x.key === line.key);
      before = round(e.was ?? perMonth(line.match, oldFrom, moveIn).monthly);
      after = 0;
      note = 'Paid off in full out of the sale proceeds — gone for good, not paused';
    } else {
      const b = perMonth(line.match, oldFrom, moveIn);
      before = round(b.monthly);
      const stated = line.statedNew ? statedPlanned.get(line.statedNew) : null;
      if (stated != null) {
        after = round(stated);
        estimate = true;
        note = 'Stated ongoing rate — the ledger has only partial charges since the move';
      } else {
        const a = perMonth(line.match, moveIn, asOf, b.gapDays);
        after = round(a.monthly);
        if (a.thin) {
          thin = true;
          note = `Only ${a.charges} charge${a.charges === 1 ? '' : 's'} since the move`
            + (b.gapDays ? `, spread at the old address's billing cadence` : '');
        }
      }
    }

    const row = {
      ...line,
      before,
      after,
      change: round(after - before),
      estimate,
      thin,
      note,
    };

    if (line.seasonal && after > before && newMonths < 4) {
      row.annualised = round(after / SUMMER_PEAK_FACTOR);
      row.note = `Measured across ${newMonths.toFixed(1)} months of Phoenix summer — the worst `
        + 'two months of the year for cooling. An annual average is nearer '
        + `$${row.annualised.toLocaleString()}.`;
    }
    return row;
  }).filter((r) => r.before !== 0 || r.after !== 0);

  const totalBefore = round(rows.reduce((s, r) => s + r.before, 0));
  const totalAfter = round(rows.reduce((s, r) => s + r.after, 0));

  // A fairer annual figure: seasonal lines de-peaked.
  const totalAfterAnnualised = round(rows.reduce(
    (s, r) => s + (r.annualised ?? r.after), 0,
  ));

  // Energy, read as one thing.
  const energyRows = rows.filter((r) => r.kind === 'energy');
  const energy = energyRows.length ? {
    rows: energyRows.map((r) => r.key),
    before: round(energyRows.reduce((s2, r) => s2 + r.before, 0)),
    after: round(energyRows.reduce((s2, r) => s2 + r.after, 0)),
    afterAnnualised: round(energyRows.reduce((s2, r) => s2 + (r.annualised ?? r.after), 0)),
    note: 'The old house had solar panels and a $250/mo loan paying for them. Its low '
      + 'electricity bill and that loan are the same fact, so they are added together here. '
      + 'The new house has no panels and no loan.',
  } : null;
  if (energy) {
    energy.change = round(energy.after - energy.before);
    energy.changeAnnualised = round(energy.afterAnnualised - energy.before);
  }

  const worse = rows.filter((r) => r.change > 0).sort((a, b) => b.change - a.change);
  const better = rows.filter((r) => r.change < 0).sort((a, b) => a.change - b.change);

  return {
    oldName: sold.name,
    newName: re.name,
    movedOn: moveIn,
    soldOn: sold.soldOn,
    oldWindow: { from: oldFrom, to: moveIn, months: round(oldMonths, 1) },
    newWindow: { from: moveIn, to: asOf, months: round(newMonths, 1) },
    rows,
    worse,
    better,
    totalBefore,
    totalAfter,
    totalAfterAnnualised,
    change: round(totalAfter - totalBefore),
    changeAnnualised: round(totalAfterAnnualised - totalBefore),
    energy,
    biggestSurprise: worse.find((r) => r.kind === 'utility') ?? worse[0] ?? null,
  };
}
