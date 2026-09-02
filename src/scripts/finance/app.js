/**
 * Dashboard shell: unlock, then render seven views over the decrypted payload.
 *
 * All aggregation happened at build time — this file only formats and draws.
 * The decrypted payload is held in a module-scoped variable and never written
 * to localStorage or sessionStorage; closing the tab ends the session.
 */

import { unlock, expandLedger } from './vault.js';
import {
  lineChart, columnChart, stackedChart, rankedBars, sparkline, donut,
  chartTable, SERIES,
} from './charts.js';

let D = null;      // decrypted payload
let LEDGER = null; // expanded transaction list

// ── Formatting ──────────────────────────────────────────────────────────────

const money = (n, dp = 0) => {
  const v = Math.abs(n);
  const s = v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${n < 0 ? '−' : ''}$${s}`;
};
const money2 = (n) => money(n, 2);
const compact = (n) => {
  const v = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (v >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${sign}$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(v)}`;
};
const pct = (n, dp = 1) => `${n.toFixed(dp)}%`;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[+mo - 1]} ${y.slice(2)}`;
};
const monthLong = (m) => {
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[+mo - 1]} ${y}`;
};
const dateLabel = (d) => {
  const [y, mo, da] = d.split('-');
  return `${MONTH_NAMES[+mo - 1]} ${+da}, ${y}`;
};
const dateShort = (d) => {
  const [, mo, da] = d.split('-');
  return `${MONTH_NAMES[+mo - 1]} ${+da}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

/**
 * Colour follows the entity, not its rank: a category keeps its hue no matter
 * what else is on screen or filtered out.
 */
let CATEGORY_COLOR = new Map();
function assignCategoryColours(categories) {
  CATEGORY_COLOR = new Map();
  categories.slice(0, 8).forEach((c, i) => CATEGORY_COLOR.set(c.name, SERIES[i]));
}
const catColor = (name) => CATEGORY_COLOR.get(name) ?? 'sn';

// ── Chart helpers ───────────────────────────────────────────────────────────

/** Wraps a chart in a figure with a caption and a table-view toggle. */
function figure(title, note, draw, tableFn) {
  const fig = h(`
    <figure class="fig">
      <figcaption class="fig-cap">
        <div>
          <h3 class="fig-title">${esc(title)}</h3>
          ${note ? `<p class="fig-note">${note}</p>` : ''}
        </div>
        <div class="fig-tools"></div>
      </figcaption>
      <div class="fig-legend" hidden></div>
      <div class="fig-plot"></div>
      <div class="fig-table" hidden></div>
    </figure>`);

  const plot = fig.querySelector('.fig-plot');
  draw(plot, fig.querySelector('.fig-legend'));

  if (tableFn) {
    const tableWrap = fig.querySelector('.fig-table');
    const btn = h('<button type="button" class="ghost-btn" aria-pressed="false">Table</button>');
    btn.addEventListener('click', () => {
      const showing = tableWrap.hidden;
      if (showing && !tableWrap.childElementCount) tableWrap.append(tableFn());
      tableWrap.hidden = !showing;
      plot.hidden = showing;
      btn.setAttribute('aria-pressed', String(showing));
      btn.textContent = showing ? 'Chart' : 'Table';
    });
    fig.querySelector('.fig-tools').append(btn);
  }
  return fig;
}

/** Legend is mandatory at two or more series; identity never rests on colour. */
function legend(host, items) {
  if (items.length < 2) { host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = items.map((i) =>
    `<span class="legend-item"><span class="legend-swatch c-${i.color}"></span>${esc(i.name)}</span>`
  ).join('');
}

function statTile({ label, value, sub, tone, note }) {
  return h(`
    <div class="stat${tone ? ` stat--${tone}` : ''}">
      <div class="stat-label">${esc(label)}${note ? ` <button type="button" class="info" data-note="${esc(note)}" aria-label="What this means">?</button>` : ''}</div>
      <div class="stat-value">${value}</div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>`);
}

const delta = (n, invert = false) => {
  const good = invert ? n < 0 : n > 0;
  const cls = n === 0 ? 'flat' : good ? 'up' : 'down';
  const arrow = n === 0 ? '' : n > 0 ? '▲' : '▼';
  return `<span class="delta delta--${cls}">${arrow} ${money(Math.abs(n))}</span>`;
};

// ═══ VIEW: Overview ═════════════════════════════════════════════════════════

function viewOverview() {
  const root = document.createElement('div');
  const H = D.headline;
  const trusted = D.meta.trustedMonths;
  const nw = D.netWorth.filter((r) => r.month >= D.meta.trustedFrom);
  const yearAgo = nw[Math.max(0, nw.length - 13)];
  const nwDelta = H.netWorth - yearAgo.netWorth;
  const deltaSpan = nw.length > 12 ? '12 months' : `${nw.length - 1} months`;

  root.append(h(`
    <section class="hero">
      <div class="hero-main">
        <div class="hero-label">Net worth</div>
        <div class="hero-value">${money(H.netWorth)}</div>
        <div class="hero-sub">
          ${delta(nwDelta)} <span class="muted">over the last ${deltaSpan}</span>
        </div>
      </div>
      <div class="hero-split">
        <div class="split-row"><span>Cash &amp; savings</span><b>${money(H.cashTotal)}</b></div>
        <div class="split-row"><span>Investments</span><b>${money(H.investTotal)}</b></div>
        <div class="split-row"><span>${esc(D.realEstate[0].name)}</span><b>${money(H.propertyValue)}</b></div>
        <div class="split-row split-row--neg"><span>Mortgage</span><b>${money(-H.mortgageBalance)}</b></div>
        <div class="split-row split-row--neg"><span>Credit cards</span><b>${money(H.creditTotal)}</b></div>
      </div>
    </section>`));

  // Data quality first — a number you shouldn't trust is worse than no number.
  if (D.dataQuality.length) root.append(dataQualityPanel());

  const tiles = h('<section class="stat-grid"></section>');
  tiles.append(
    statTile({
      label: 'Take-home, monthly',
      value: money(H.statedMonthlyNet),
      sub: `Ledger shows ${money(H.payrollMonthly)}/mo of payroll over the last 12 months`,
      note: 'Your stated net pay: $2,000 + $2,800 biweekly, 26 cheques a year.',
    }),
    statTile({
      label: 'Spending, monthly',
      value: money(H.avgExpense),
      sub: `Last 3 months ran ${money(H.avgExpense3)}`,
      tone: H.avgExpense > H.statedMonthlyNet ? 'warn' : null,
      note: 'Trailing 12-month average, with the one-time house money held out.',
    }),
    statTile({
      label: 'Saved & invested',
      value: `${money(H.trueSavingsMonthly)}/mo`,
      sub: `${pct(H.trueSavingsRate)} of gross · ${money(H.payrollSavingsMonthly)} of it never `
        + 'touches the bank',
      tone: H.trueSavingsRate > 15 ? 'good' : null,
      note: 'Bank transfers to investments plus everything payroll takes first: the ASRS '
        + 'pension, both 403(b)s, the HSA, and the district\'s pension match.',
    }),
    statTile({
      label: 'Housing cost',
      value: pct(H.housingRatio),
      sub: `${money(D.mortgage.buydown.borrowerPI + D.mortgage.escrow.totalMonthly)}/mo of take-home`,
      tone: H.housingRatio > 35 ? 'warn' : null,
      note: 'The 28/36 rule of thumb puts housing under 28% of gross. This is measured against net pay, which is a stricter test.',
    }),
    statTile({
      label: 'Home equity',
      value: money(H.homeEquity),
      sub: `${money(H.propertyValue)} appraised − ${money(H.mortgageBalance)} owed`,
    }),
    statTile({
      label: 'Cash runway',
      value: `${H.runwayMonths} mo`,
      sub: `${money(H.liquid)} liquid ÷ ${money(H.avgExpense)}/mo`,
      tone: H.runwayMonths < 3 ? 'warn' : H.runwayMonths > 6 ? 'good' : null,
    }),
  );
  root.append(tiles);

  // ── Net worth over time
  root.append(figure(
    'Net worth',
    `Starts ${monthLong(D.meta.trustedFrom)} — the point from which rolling today's `
    + 'balances backward through the ledger still produces plausible figures. Investments '
    + 'are walked back by known contributions and withdrawals only; market movement before '
    + 'today is not modelled.',
    (plot, leg) => {
      lineChart(plot, {
        labels: trusted.map(monthLabel),
        height: 300,
        series: [
          { name: 'Net worth', values: nw.map((r) => r.netWorth), color: 's1', fill: true },
          { name: 'Liquid (cash − cards)', values: nw.map((r) => r.liquid), color: 's3' },
        ],
        yFmt: compact,
        tipFmt: money,
        tipLabel: (i) => monthLong(trusted[i]),
      });
      legend(leg, [
        { name: 'Net worth', color: 's1' },
        { name: 'Liquid (cash − cards)', color: 's3' },
      ]);
    },
    () => chartTable(['Month', 'Net worth', 'Liquid', 'Investments', 'Property', 'Debt'],
      nw.slice().reverse().map((r) => [monthLong(r.month), money(r.netWorth),
        money(r.liquid), money(r.investments), money(r.property), money(r.debt)])),
  ));

  // ── Income vs spending
  const recent = D.monthlyOrdinary.slice(-25, -1);
  root.append(figure(
    'Income and spending',
    'Last 24 complete months, excluding the house transition. Bars are what actually moved through the accounts.',
    (plot, leg) => {
      columnChart(plot, {
        labels: recent.map((m) => monthLabel(m.month)),
        height: 250,
        series: [
          { name: 'Income', values: recent.map((m) => m.income), color: 's3' },
          { name: 'Spending', values: recent.map((m) => -m.expense), color: 's2' },
        ],
        yFmt: compact,
        tipFmt: (v) => money(Math.abs(v)),
        tipLabel: (i) => monthLong(recent[i].month),
      });
      legend(leg, [{ name: 'Income', color: 's3' }, { name: 'Spending', color: 's2' }]);
    },
    () => chartTable(['Month', 'Income', 'Spending', 'Net'],
      recent.slice().reverse().map((m) => [monthLong(m.month), money(m.income),
        money(m.expense), money(m.net)])),
  ));

  // ── Where it goes
  const cats = D.categories.t12.slice(0, 10);
  root.append(figure(
    'Where the money goes',
    `Trailing 12 months to ${monthLong(D.meta.t12[11])}. Click a category for the detail.`,
    (plot) => {
      rankedBars(plot, cats.map((c) => ({
        label: esc(c.name),
        value: c.total,
        color: catColor(c.name),
        meta: `${money(c.avgMonth)}/mo`,
      })), {
        fmt: money,
        onClick: (r) => go('spending', r.label),
      });
    },
    () => chartTable(['Category', 'Total', 'Per month', 'Transactions'],
      cats.map((c) => [c.name, money(c.total), money(c.avgMonth), c.count])),
  ));

  return root;
}

// ── Data quality panel ──────────────────────────────────────────────────────

function dataQualityPanel() {
  const icon = { serious: '▲', warning: '●', good: '✓' };
  const sec = h(`
    <section class="dq">
      <h2 class="dq-head">Before you trust these numbers</h2>
      <div class="dq-list"></div>
    </section>`);
  const list = sec.querySelector('.dq-list');
  for (const d of D.dataQuality) {
    list.append(h(`
      <div class="dq-item dq-item--${d.severity}">
        <span class="dq-icon" aria-hidden="true">${icon[d.severity] ?? '●'}</span>
        <div>
          <div class="dq-title">${esc(d.title)}
            <span class="dq-sev">${d.severity === 'serious' ? 'Worth fixing'
    : d.severity === 'warning' ? 'Heads up' : 'Fine'}</span>
          </div>
          <p class="dq-detail">${esc(d.detail)}</p>
        </div>
      </div>`));
  }
  return sec;
}


// ═══ VIEW: Paycheck ═════════════════════════════════════════════════════════

function viewPaycheck() {
  const root = document.createElement('div');
  const { earners, household: hh, tax } = D.paycheck;

  root.append(h(`<div class="view-intro">
    <h2>Paycheck</h2>
    <p>Both receipts from Agua Fria Union HSD, biweekly, ${hh.periods} periods a year.
    This is the half of the picture the bank never sees: the pension, both 403(b)s and
    the HSA all come out before the deposit lands.</p>
  </div>`));

  root.append(h(`<section class="stat-grid stat-grid--4">
    <div class="stat"><div class="stat-label">Household gross</div>
      <div class="stat-value">${money(hh.annualGross)}</div>
      <div class="stat-sub">${money(hh.grossPerPeriod)} every two weeks</div></div>
    <div class="stat"><div class="stat-label">Lands in the bank</div>
      <div class="stat-value">${money(hh.annualNet)}</div>
      <div class="stat-sub">${money(hh.netPerPeriod)} per period · ${money(hh.monthlyNet)}/mo</div></div>
    <div class="stat stat--good"><div class="stat-label">Saved before you see it</div>
      <div class="stat-value">${money(hh.trueSavingsAnnual)}</div>
      <div class="stat-sub">${pct(hh.trueSavingsRateOfGross)} of gross — pension, 403(b)s, HSA, employer match</div></div>
    <div class="stat"><div class="stat-label">Total compensation</div>
      <div class="stat-value">${money(hh.totalComp)}</div>
      <div class="stat-sub">Including ${money(hh.annualEmployerBenefits)} of employer-paid benefits</div></div>
  </section>`));

  // Where each gross dollar actually goes.
  const slices = [
    { name: 'Take-home', value: hh.annualNet, color: 's1' },
    { name: 'Retirement (ASRS + 403(b))', value: hh.annualRetirement, color: 's3' },
    { name: 'Tax & FICA', value: round0(hh.taxPerPeriod * hh.periods), color: 's2' },
    { name: 'Insurance', value: round0(hh.insurancePerPeriod * hh.periods), color: 's4' },
    { name: 'Dependent care', value: hh.annualDependentCare, color: 's5' },
    { name: 'HSA', value: hh.annualHsa, color: 's6' },
  ].filter((x) => x.value > 0);

  const comp = h('<section class="two-col"></section>');
  const dbox = h('<div class="donut-box"></div>');
  donut(dbox, slices, { centerValue: compact(hh.annualGross), centerLabel: 'gross' });
  const list = h('<div class="comp-list"></div>');
  for (const x of slices) {
    list.append(h(`<div class="comp-row">
      <span class="legend-swatch c-${x.color}"></span>
      <span class="comp-name">${esc(x.name)}</span>
      <span class="comp-pct muted">${pct((x.value / hh.annualGross) * 100, 0)}</span>
      <span class="comp-val">${money(x.value)}</span>
    </div>`));
  }
  comp.append(dbox, list);
  root.append(h('<h3 class="section-head">Where every gross dollar goes</h3>'));
  root.append(comp);

  // Line-by-line, per earner.
  root.append(h('<h3 class="section-head">Line by line</h3>'));
  for (const e of earners) {
    const sec = h(`<section class="stub">
      <div class="stub-head">
        <div>
          <h4>${esc(e.name)}</h4>
          <div class="muted">${esc(e.title)} · receipt dated ${dateLabel(e.payDate)}</div>
        </div>
        <div class="stub-net">
          <span class="muted">${money2(e.gross)} gross →</span>
          <b>${money2(e.net)}</b>
        </div>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Deduction</th><th>Type</th><th class="num">Per period</th>
        <th class="num">Per year</th><th class="num">Of gross</th></tr></thead>
        <tbody></tbody></table></div>
    </section>`);
    const tb = sec.querySelector('tbody');
    const kindColor = {
      retirement: 's3', hsa: 's6', dependentcare: 's5', tax: 's2', insurance: 's4',
    };
    const kindLabel = {
      retirement: 'Retirement', hsa: 'HSA', dependentcare: 'Dependent care',
      tax: 'Tax', insurance: 'Insurance',
    };
    for (const d of [...e.deductions].sort((a, b) => b.amount - a.amount)) {
      const annual = d.annualCap ?? d.amount * e.periods;
      tb.append(h(`<tr${d.amount === 0 ? ' class="row-zero"' : ''}>
        <td><span class="cell-dot c-${kindColor[d.kind] ?? 'sn'}"></span>${esc(d.name)}
          ${d.preTax ? '<span class="pill">pre-tax</span>' : ''}
          ${d.amount === 0 ? '<span class="pill pill--warn">nothing withheld</span>' : ''}</td>
        <td class="muted">${kindLabel[d.kind] ?? d.kind}</td>
        <td class="num">${money2(d.amount)}</td>
        <td class="num">${money(annual)}</td>
        <td class="num muted">${pct((annual / (e.gross * e.periods)) * 100, 1)}</td>
      </tr>`));
    }
    tb.append(h(`<tr class="tr-total"><td><b>Take-home</b></td><td></td>
      <td class="num"><b>${money2(e.net)}</b></td>
      <td class="num"><b>${money(e.annualNet)}</b></td>
      <td class="num"><b>${pct((e.annualNet / e.annualGross) * 100, 0)}</b></td></tr>`));

    const emp = h(`<details class="emp-details">
      <summary>Employer also pays ${money2(e.employerPaidTotal)} a period
        (${money(e.employerPaidTotal * e.periods)} a year) on top</summary>
      <ul class="mini-list">${e.employerPaid.map((x) =>
    `<li><span>${esc(x.name)}</span><b>${money2(x.amount)}</b></li>`).join('')}</ul>
    </details>`);
    sec.append(emp);
    root.append(sec);
  }

  // Withholding projection.
  if (tax) {
    const a = tax.assumptions;
    const short = tax.totalGap > 0;
    root.append(h('<h3 class="section-head">Withholding, checked against a projection</h3>'));
    root.append(h(`<div class="alert alert--${short ? 'serious' : 'sum'}">
      <div class="alert-when">${a.year} estimate</div>
      <div>
        <h4>${short
    ? `About ${money(tax.totalGap)} more may be owed than is being withheld`
    : `Withholding is running about ${money(Math.abs(tax.totalGap))} ahead of the estimate`}</h4>
        <p>Olivia's receipt withholds <b>no federal tax at all</b> — state and FICA only — so the
        household's entire federal withholding is Luke's ${money(tax.federalWithheld)} a year.
        This is arithmetic over the assumptions below, not tax advice; the numbers are laid out
        so whoever files the return can check them.</p>
      </div>
    </div>`));

    const work = h(`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Step</th><th class="num">Amount</th><th>Note</th></tr></thead>
      <tbody></tbody></table></div>`);
    const wb = work.querySelector('tbody');
    const row = (label, val, note, cls = '') => wb.append(h(
      `<tr class="${cls}"><td>${label}</td><td class="num">${money(val)}</td>
       <td class="muted">${note}</td></tr>`));

    row('Household gross', hh.annualGross, `${money(hh.grossPerPeriod)} × ${hh.periods} periods`);
    row('Less pre-tax deductions', -hh.annualPreTax,
      'Pension, traditional 403(b), HSA, dependent care, medical, dental, vision');
    row('Federal wages', tax.federalWages, 'Roughly what shows in W-2 box 1');
    row('Less standard deduction', -a.standardDeduction,
      `${esc(a.filingStatus)} — <span class="est">estimated ${a.year} figure</span>`);
    row('Taxable income', tax.taxableIncome, '', 'tr-rule');
    for (const b of tax.bands) {
      row(`&nbsp;&nbsp;at ${pct(b.rate * 100, 0)}`, b.tax, `on ${money(b.amount)}`);
    }
    row('Federal tax before credits', tax.grossFederalTax, '');
    row('Less child tax credit', -tax.credits,
      `<span class="est">assumes ${a.dependentChildren} qualifying children</span> at ${money(a.childTaxCredit)} each`);
    row('Federal tax on wages', tax.federalOnWages, '', 'tr-rule');
    row('Federal withheld', -tax.federalWithheld, 'Luke only — Olivia withholds nothing');
    row('Gap on wages', tax.federalGapOnWages, '', 'tr-total');
    row('Plus tax on the Wealthfront sale', tax.federalOnGains + tax.stateOnGains,
      `<span class="est">assumes ${pct(a.capitalGainsAssumption.assumedGainShare * 100, 0)} of the `
      + `${money(a.capitalGainsAssumption.proceeds)} withdrawal was long-term gain</span>`);
    row('Arizona, net of withholding', tax.stateGap,
      `${pct(a.azFlatRate * 100, 1)} flat — currently slightly over-withheld`);
    row('Estimated shortfall', tax.totalGap, '', 'tr-total');
    root.append(work);

    root.append(h(`<div class="method">
      <h4>What would move this number</h4>
      <p><b>The cost basis of the Wealthfront sale.</b> ${esc(a.capitalGainsAssumption.method)}
      ${esc(a.capitalGainsAssumption.note.replace(/^VERIFY\.\s*/, ''))}</p>
      <p><b>The number of qualifying children.</b> This assumes ${a.dependentChildren}, inferred
      from the 529 accounts. Each one is worth about ${money(a.childTaxCredit)} off the bill.</p>
      <p><b>${a.year} brackets and the standard deduction</b> are estimates; the final figures
      shift the result by a few hundred dollars either way.</p>
      <p>None of this accounts for itemising, the mortgage-interest deduction on a
      ${money(D.mortgage.originalPrincipal)} loan at ${pct(D.mortgage.rate * 100, 3)} — which in a
      first full year is real money and pushes in the opposite direction — or anything else
      specific to your return.</p>
    </div>`));
  }

  return root;
}

const round0 = (n) => Math.round(n);

// ═══ VIEW: Cash flow ════════════════════════════════════════════════════════

function viewCashflow() {
  const root = document.createElement('div');
  const mo = D.monthlyOrdinary.slice(0, -1);
  const last = mo.slice(-36);

  root.append(h(`<div class="view-intro">
    <h2>Cash flow</h2>
    <p>What came in, what went out, month by month, from ${monthLong(D.meta.months[0])}
    to ${monthLong(D.meta.months.at(-1))}. The July–September 2026 house money is held
    out of everything here — it has its own page.</p>
  </div>`));

  const avg = (arr, k, n) => arr.slice(-n).reduce((s, m) => s + m[k], 0) / n;
  const tiles = h('<section class="stat-grid stat-grid--4"></section>');
  for (const n of [3, 6, 12, 24]) {
    const inc = avg(mo, 'income', n);
    const exp = avg(mo, 'expense', n);
    tiles.append(statTile({
      label: `Trailing ${n} months`,
      value: `${money(inc - exp)}/mo`,
      sub: `${money(inc)} in · ${money(exp)} out`,
      tone: inc - exp > 0 ? 'good' : 'warn',
    }));
  }
  root.append(tiles);

  root.append(figure(
    'Monthly surplus and deficit',
    'Income minus spending. Bars below the line are months that ran on savings.',
    (plot) => {
      columnChart(plot, {
        labels: last.map((m) => monthLabel(m.month)),
        height: 240,
        series: [{ name: 'Net', values: last.map((m) => m.net), color: 's1' }],
        yFmt: compact,
        tipFmt: money,
        tipLabel: (i) => monthLong(last[i].month),
      });
    },
    () => chartTable(['Month', 'Income', 'Spending', 'Net', 'Saved'],
      last.slice().reverse().map((m) => [monthLong(m.month), money(m.income),
        money(m.expense), money(m.net), money(m.savings)])),
  ));

  // Payroll seasonality — the summer trough is a real planning constraint.
  const pay = D.payrollByMonth.slice(-36);
  root.append(figure(
    'Payroll, month by month',
    'District pay is not flat. Summer months run light and December carries a third pay period — '
    + 'so a budget built on the annual average will be short in July and flush in December.',
    (plot) => {
      columnChart(plot, {
        labels: pay.map((p) => monthLabel(p.month)),
        height: 220,
        series: [{ name: 'Payroll', values: pay.map((p) => p.amount), color: 's4' }],
        yFmt: compact,
        tipFmt: money,
        tipLabel: (i) => monthLong(pay[i].month),
      });
    },
    () => chartTable(['Month', 'Payroll deposits'],
      pay.slice().reverse().map((p) => [monthLong(p.month), money(p.amount)])),
  ));

  // Year-over-year, over the whole record.
  const byYear = new Map();
  for (const m of mo) {
    const y = m.month.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, { year: y, income: 0, expense: 0, savings: 0, months: 0 });
    const b = byYear.get(y);
    b.income += m.income; b.expense += m.expense; b.savings += m.savings; b.months++;
  }
  // Drop partial years at either end so the comparison is like-for-like.
  const years = [...byYear.values()].filter((y) => y.months === 12);
  if (years.length > 2) {
    root.append(figure(
      'Year by year',
      `${years[0].year} to ${years.at(-1).year}, complete years only. `
      + 'Mint recorded the earlier half of this and Simplifi the later half, so the '
      + 'category mix shifts at the 2024 handover even where the spending did not. '
      + 'Saved-and-invested is left off this chart: Mint did not consistently mark '
      + 'contributions, so the two halves would not be comparable.',
      (plot, leg) => {
        columnChart(plot, {
          labels: years.map((y) => y.year),
          height: 240,
          xEvery: 1,
          series: [
            { name: 'Income', values: years.map((y) => y.income), color: 's3' },
            { name: 'Spending', values: years.map((y) => y.expense), color: 's2' },
          ],
          yFmt: compact,
          tipFmt: money,
        });
        legend(leg, [
          { name: 'Income', color: 's3' },
          { name: 'Spending', color: 's2' },
        ]);
      },
      () => chartTable(['Year', 'Income', 'Spending', 'Net', 'Saved & invested'],
        years.slice().reverse().map((y) => [y.year, money(y.income), money(y.expense),
          money(y.income - y.expense), money(y.savings)])),
    ));
  }

  // Calendar-month seasonality, averaged across years.
  const byCal = Array.from({ length: 12 }, () => []);
  for (const m of mo) byCal[+m.month.split('-')[1] - 1].push(m.expense);
  const calAvg = byCal.map((xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0));
  root.append(figure(
    'Spending by month of year',
    `Average across ${new Set(mo.map((m) => m.month.slice(0, 4))).size} years of records. `
    + 'Useful for knowing which months to pad.',
    (plot) => {
      columnChart(plot, {
        labels: MONTH_NAMES,
        height: 200,
        xEvery: 1,
        series: [{ name: 'Average spending', values: calAvg, color: 's2' }],
        yFmt: compact,
        tipFmt: money,
      });
    },
    () => chartTable(['Month', 'Average spending'],
      MONTH_NAMES.map((n, i) => [n, money(calAvg[i])])),
  ));

  return root;
}

// ═══ VIEW: Spending ═════════════════════════════════════════════════════════

let spendingFocus = null;

function viewSpending() {
  const root = document.createElement('div');
  const cats = D.categories.t12;

  root.append(h(`<div class="view-intro">
    <h2>Spending</h2>
    <p>Trailing twelve months, ${monthLong(D.meta.t12[0])} to ${monthLong(D.meta.t12[11])}.</p>
  </div>`));

  // Budget vs actual for the current month.
  if (D.budgets.length) {
    const grid = h('<section class="budget-grid"></section>');
    for (const b of D.budgets) {
      const ratio = b.target ? b.actual / b.target : 0;
      const tone = ratio > 1 ? 'over' : ratio > 0.85 ? 'near' : 'under';
      grid.append(h(`
        <div class="budget budget--${tone}">
          <div class="budget-head">
            <span class="budget-name">${esc(b.name)}</span>
            <span class="budget-ratio">${pct(ratio * 100, 0)}</span>
          </div>
          <div class="budget-track">
            <span class="budget-fill c-${catColor(b.name)}" style="width:${Math.min(100, ratio * 100)}%"></span>
            ${ratio > 1 ? '<span class="budget-over" style="width:' + Math.min(100, (ratio - 1) * 100) + '%"></span>' : ''}
          </div>
          <div class="budget-foot">
            <span>${money(b.actual)} of ${money(b.target)}</span>
            <span class="muted">avg ${money(b.average)}</span>
          </div>
        </div>`));
    }
    root.append(h(`<h3 class="section-head">This month against target
      <span class="muted">— ${monthLong(D.meta.months.at(-1))}, ${Math.round(
    (Date.parse(`${D.meta.asOf}T00:00:00Z`) - Date.parse(`${D.meta.months.at(-1)}-01T00:00:00Z`))
        / 86400000) + 1} days in</span></h3>`));
    root.append(grid);
  }

  // Category detail with drill-down.
  root.append(h('<h3 class="section-head">Categories</h3>'));
  const detail = h('<div class="cat-detail"></div>');
  root.append(figure(
    'Twelve-month totals',
    'Select a category to see its subcategories, merchants and trend.',
    (plot) => {
      rankedBars(plot, cats.map((c) => ({
        label: esc(c.name), value: c.total, color: catColor(c.name),
        meta: `${money(c.avgMonth)}/mo`,
      })), { fmt: money, onClick: (r) => renderCatDetail(detail, r.label) });
    },
    () => chartTable(['Category', 'Total', 'Per month', 'Count'],
      cats.map((c) => [c.name, money(c.total), money(c.avgMonth), c.count])),
  ));
  root.append(detail);
  renderCatDetail(detail, spendingFocus ?? cats[0]?.name);

  // Unusual months.
  if (D.anomalies.length) {
    root.append(h('<h3 class="section-head">Unusual months</h3>'));
    const list = h('<div class="anom-list"></div>');
    for (const a of D.anomalies.slice(0, 10)) {
      list.append(h(`
        <div class="anom">
          <span class="anom-dot c-${catColor(a.category)}"></span>
          <span class="anom-cat">${esc(a.category)}</span>
          <span class="anom-month">${monthLong(a.month)}</span>
          <span class="anom-amt">${money(a.amount)}</span>
          <span class="anom-typ muted">usually ${money(a.typical)}</span>
          <span class="anom-exc">+${money(a.excess)}</span>
        </div>`));
    }
    root.append(list);
  }

  // Merchants.
  root.append(h('<h3 class="section-head">Where you actually shop</h3>'));
  root.append(figure(
    'Top merchants, last 12 months', null,
    (plot) => {
      rankedBars(plot, D.merchants.slice(0, 18).map((m) => ({
        label: esc(m.label), value: m.total, color: catColor(m.category),
        meta: `${m.count}× · ${money(m.avg)} avg`,
      })), { fmt: money });
    },
    () => chartTable(['Merchant', 'Total', 'Visits', 'Average', 'Category'],
      D.merchants.slice(0, 40).map((m) => [m.label, money(m.total), m.count,
        money(m.avg), m.category])),
  ));

  return root;
}

function renderCatDetail(host, name) {
  const c = D.categories.t12.find((x) => x.name === name);
  if (!c) { host.innerHTML = ''; return; }
  spendingFocus = name;

  const merch = new Map();
  for (const t of LEDGER) {
    if (t.flow !== 'expense') continue;
    if (!D.meta.t12.includes(t.date.slice(0, 7))) continue;
    if ((t.category || 'Uncategorized').split(':')[0] !== name) continue;
    merch.set(t.payee, (merch.get(t.payee) ?? 0) + -t.amount);
  }
  const topMerch = [...merch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  host.innerHTML = '';
  const card = h(`
    <div class="cat-card">
      <div class="cat-card-head">
        <span class="cat-dot c-${catColor(c.name)}"></span>
        <h4>${esc(c.name)}</h4>
        <span class="cat-total">${money(c.total)} <span class="muted">· ${money(c.avgMonth)}/mo · ${c.count} transactions</span></span>
      </div>
      <div class="cat-card-body">
        <div class="cat-col">
          <h5>Trend</h5>
          <div class="cat-trend"></div>
        </div>
        <div class="cat-col">
          <h5>Breakdown</h5>
          <ul class="mini-list">${c.subs.slice(0, 8).map((s) =>
    `<li><span>${esc(s.name)}</span><b>${money(s.total)}</b></li>`).join('')}</ul>
        </div>
        <div class="cat-col">
          <h5>Merchants</h5>
          <ul class="mini-list">${topMerch.map(([p, v]) =>
    `<li><span>${esc(p)}</span><b>${money(v)}</b></li>`).join('')}</ul>
        </div>
      </div>
    </div>`);

  const trend = card.querySelector('.cat-trend');
  columnChart(trend, {
    labels: D.meta.t12.map(monthLabel),
    height: 150,
    padLeft: 48,
    xEvery: 2,
    series: [{ name: c.name, values: c.series, color: catColor(c.name) }],
    yFmt: compact,
    tipFmt: money,
    tipLabel: (i) => monthLong(D.meta.t12[i]),
  });

  host.append(card);
}

// ═══ VIEW: Recurring ════════════════════════════════════════════════════════

function viewRecurring() {
  const root = document.createElement('div');
  const active = D.recurring.filter((r) => r.status === 'active');
  const lapsed = D.recurring.filter((r) => r.status === 'lapsed');
  const fixed = active.filter((r) => r.kind === 'fixed');
  const variable = active.filter((r) => r.kind === 'variable');
  const annualTotal = active.reduce((s, r) => s + r.annual, 0);

  root.append(h(`<div class="view-intro">
    <h2>Recurring</h2>
    <p>Detected by looking for a merchant that charges on a regular cadence, not
    just one that charges often — so forty Amazon orders don't read as a subscription.</p>
  </div>`));

  root.append(h(`<section class="stat-grid stat-grid--3">
    <div class="stat"><div class="stat-label">Committed each year</div>
      <div class="stat-value">${money(annualTotal)}</div>
      <div class="stat-sub">${money(annualTotal / 12)}/mo across ${active.length} recurring charges</div></div>
    <div class="stat"><div class="stat-label">Fixed-price</div>
      <div class="stat-value">${money(fixed.reduce((s, r) => s + r.annual, 0))}</div>
      <div class="stat-sub">${fixed.length} subscriptions and flat bills</div></div>
    <div class="stat"><div class="stat-label">Variable</div>
      <div class="stat-value">${money(variable.reduce((s, r) => s + r.annual, 0))}</div>
      <div class="stat-sub">${variable.length} bills that move with usage</div></div>
  </section>`));

  const table = (rows, title, note) => {
    const sec = h(`<section class="rec-section">
      <h3 class="section-head">${esc(title)}${note ? ` <span class="muted">— ${note}</span>` : ''}</h3>
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>Merchant</th><th>Category</th><th>Cadence</th>
          <th class="num">Typical</th><th class="num">Range</th>
          <th class="num">Per year</th><th>Next due</th>
        </tr></thead><tbody></tbody>
      </table></div>
    </section>`);
    const tb = sec.querySelector('tbody');
    for (const r of rows) {
      tb.append(h(`<tr>
        <td><span class="cell-dot c-${catColor(r.category)}"></span>${esc(r.label)}
          ${r.priceChange ? `<span class="pill pill--warn">up ${money2(r.priceChange)}</span>` : ''}</td>
        <td class="muted">${esc(r.category)}</td>
        <td>${esc(r.cadence)}</td>
        <td class="num">${money2(r.amount)}</td>
        <td class="num muted">${r.kind === 'fixed' ? '—' : `${money(r.low)}–${money(r.high)}`}</td>
        <td class="num"><b>${money(r.annual)}</b></td>
        <td class="${r.status === 'lapsed' ? 'muted' : ''}">${r.status === 'lapsed'
    ? `last ${dateLabel(r.last)}` : dateLabel(r.nextDue)}</td>
      </tr>`));
    }
    return sec;
  };

  root.append(table(fixed, 'Subscriptions and flat bills',
    'same amount every time'));
  root.append(table(variable, 'Variable bills',
    'regular cadence, amount moves with usage'));
  if (lapsed.length) {
    root.append(table(lapsed, 'Stopped',
      'was regular, has not charged in a while — worth confirming these are meant to be gone'));
  }
  return root;
}

// ═══ VIEW: Net worth / accounts ═════════════════════════════════════════════

function viewAccounts() {
  const root = document.createElement('div');
  const H = D.headline;

  root.append(h(`<div class="view-intro">
    <h2>Balance sheet</h2>
    <p>As of ${dateLabel(D.meta.asOf)}.</p>
  </div>`));

  const groups = [
    {
      title: 'Cash and savings',
      rows: D.accounts.filter((a) => a.class === 'asset')
        .map((a) => ({ name: a.name, value: a.balance, meta: a.group })),
    },
    {
      title: 'Investments',
      rows: D.investments.holdings.filter((x) => x.balance !== 0)
        .map((x) => ({ name: x.name, value: x.balance, meta: x.group })),
    },
    {
      title: 'Property',
      rows: D.realEstate.map((r) => ({
        name: r.label, value: r.value, meta: `Appraised ${dateLabel('2026-07-01')}`,
      })),
    },
    {
      title: 'Liabilities',
      rows: [
        ...D.accounts.filter((a) => a.class === 'liability')
          .map((a) => ({ name: a.name, value: a.balance, meta: 'Credit card' })),
        {
          name: D.mortgage.name,
          value: -D.mortgage.currentBalance,
          meta: `${pct(D.mortgage.rate * 100, 3)} fixed · 30 years`,
        },
        ...(D.privateLoans ?? [])
          .filter((l) => !l.repaidOn || l.repaidOn > D.meta.asOf)
          .map((l) => ({ name: l.name, value: -l.amount, meta: `From ${l.lender}` })),
      ],
    },
  ];

  const sheet = h('<section class="sheet"></section>');
  for (const g of groups) {
    const total = g.rows.reduce((s, r) => s + r.value, 0);
    const block = h(`<div class="sheet-group">
      <div class="sheet-head"><h3>${esc(g.title)}</h3><b>${money(total)}</b></div>
      <div class="sheet-rows"></div>
    </div>`);
    const rows = block.querySelector('.sheet-rows');
    for (const r of g.rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))) {
      rows.append(h(`<div class="sheet-row">
        <span class="sheet-name">${esc(r.name)}</span>
        <span class="sheet-meta muted">${esc(r.meta)}</span>
        <span class="sheet-val${r.value < 0 ? ' neg' : ''}">${money(r.value)}</span>
      </div>`));
    }
    sheet.append(block);
  }
  sheet.append(h(`<div class="sheet-total">
    <span>Net worth</span><b>${money(H.netWorth)}</b>
  </div>`));
  root.append(sheet);

  // Composition
  const slices = [
    { name: 'Home equity', value: H.homeEquity, color: 's1' },
    { name: 'Retirement', value: D.investments.holdings
      .filter((x) => x.group === 'Retirement').reduce((s, x) => s + x.balance, 0), color: 's2' },
    { name: 'Taxable brokerage', value: D.investments.holdings
      .filter((x) => x.group === 'Taxable brokerage').reduce((s, x) => s + x.balance, 0), color: 's3' },
    { name: '529 college savings', value: D.investments.holdings
      .filter((x) => x.group === '529 college savings').reduce((s, x) => s + x.balance, 0), color: 's4' },
    { name: 'Cash', value: H.cashTotal, color: 's5' },
    { name: 'HSA', value: D.investments.holdings
      .filter((x) => x.group === 'HSA').reduce((s, x) => s + x.balance, 0), color: 's6' },
  ].filter((s) => s.value > 0);

  const comp = h(`<section class="two-col"></section>`);
  const donutBox = h('<div class="donut-box"></div>');
  donut(donutBox, slices, {
    centerValue: compact(slices.reduce((s, x) => s + x.value, 0)),
    centerLabel: 'net assets',
  });
  const list = h('<div class="comp-list"></div>');
  const tot = slices.reduce((s, x) => s + x.value, 0);
  for (const s of slices) {
    list.append(h(`<div class="comp-row">
      <span class="legend-swatch c-${s.color}"></span>
      <span class="comp-name">${esc(s.name)}</span>
      <span class="comp-pct muted">${pct((s.value / tot) * 100, 0)}</span>
      <span class="comp-val">${money(s.value)}</span>
    </div>`));
  }
  comp.append(donutBox, list);
  root.append(h('<h3 class="section-head">Composition</h3>'));
  root.append(comp);

  // Stacked history
  const nw = D.netWorth.filter((r) => r.month >= D.meta.trustedFrom);
  root.append(figure(
    'How the balance sheet got here',
    'Assets only. The July 2026 spike is the seven weeks of owning both houses; '
    + `the drop is ${D.soldHome.name} selling and its equity turning into cash, then into `
    + 'the index fund.',
    (plot, leg) => {
      stackedChart(plot, {
        labels: D.meta.trustedMonths.map(monthLabel),
        height: 280,
        series: [
          { name: 'Property', values: nw.map((r) => r.property), color: 's1' },
          { name: 'Investments', values: nw.map((r) => r.investments), color: 's2' },
          { name: 'Cash', values: nw.map((r) => Math.max(0, r.cash)), color: 's3' },
        ],
        yFmt: compact,
        tipFmt: money,
        tipLabel: (i) => monthLong(D.meta.trustedMonths[i]),
      });
      legend(leg, [
        { name: 'Property', color: 's1' },
        { name: 'Investments', color: 's2' },
        { name: 'Cash', color: 's3' },
      ]);
    },
    () => chartTable(['Month', 'Property', 'Investments', 'Cash', 'Debt'],
      nw.slice().reverse().map((r) => [monthLong(r.month), money(r.property),
        money(r.investments), money(r.cash), money(r.debt)])),
  ));

  root.append(h(`<div class="method">
    <h4>How these numbers were built</h4>
    <p><b>Cash and credit cards</b> are the honest part: today's balance rolled backward
    through every transaction in the ledger. That only holds while the ledger is complete,
    and this export is truncated at January 2020 — rolled back far enough, the credit cards
    reconstruct to a positive balance, which cannot happen. So the charts start at
    ${monthLong(D.meta.trustedFrom)}, the earliest month from which every account stays
    plausible through to today.</p>
    <p><b>Investments</b> are today's value walked back by contributions and withdrawals
    only. Market movement is not modelled, so the historical line understates growth and
    should be read as "money put in", not "what it was worth".</p>
    <p><b>Property</b> is a step function at known valuations — ${money(D.realEstate[0].value)}
    for ${esc(D.realEstate[0].name)} from the July 2026 appraisal, and the prior estimate for
    ${esc(D.soldHome.name)} until it sold on ${dateLabel(D.soldHome.soldOn)}. Neither is a live
    market estimate.</p>
    <p><b>The mortgage</b> is amortised from the executed Closing Disclosure, so it is exact.</p>
  </div>`));

  return root;
}

// ═══ VIEW: The house ════════════════════════════════════════════════════════

function viewHouse() {
  const root = document.createElement('div');
  const re = D.realEstate[0];
  const m = D.mortgage;
  const bd = m.buydown;

  root.append(h(`<div class="view-intro">
    <h2>${esc(re.name)}</h2>
    <p>Closed ${dateLabel(re.closedOn)} · ${re.sqft.toLocaleString()} sq ft on
    ${(re.lotSqft / 43560).toFixed(2)} acres · ${re.beds} bed, ${re.baths} bath · built ${re.yearBuilt}</p>
  </div>`));

  root.append(h(`<section class="stat-grid stat-grid--4">
    <div class="stat"><div class="stat-label">Bought for</div>
      <div class="stat-value">${money(re.purchasePrice)}</div>
      <div class="stat-sub">Appraised ${money(re.value)} — ${money(re.value - re.purchasePrice)} under market</div></div>
    <div class="stat"><div class="stat-label">Owed</div>
      <div class="stat-value">${money(m.currentBalance)}</div>
      <div class="stat-sub">${pct(m.rate * 100, 3)} fixed, 30 years, no PMI</div></div>
    <div class="stat stat--good"><div class="stat-label">Equity today</div>
      <div class="stat-value">${money(re.value - m.currentBalance)}</div>
      <div class="stat-sub">${pct(((re.value - m.currentBalance) / re.value) * 100, 0)} of appraised value</div></div>
    <div class="stat"><div class="stat-label">Payment now</div>
      <div class="stat-value">${money(bd.borrowerPI + m.escrow.totalMonthly)}</div>
      <div class="stat-sub">${money2(bd.borrowerPI)} P&amp;I + ${money2(m.escrow.totalMonthly)} escrow</div></div>
  </section>`));

  // The two payment shocks, which is the whole point of this page.
  root.append(h(`<section class="alerts">
    <div class="alert alert--serious">
      <div class="alert-when">Sep 2027</div>
      <div>
        <h4>The buydown expires — payment rises ${money2(bd.monthlySubsidy)}/mo</h4>
        <p>UWM is paying ${money2(bd.monthlySubsidy)} of your interest every month for the first
        ${bd.months} payments, which is why you pay ${money2(bd.borrowerPI)} instead of
        ${money2(m.monthlyPI)}. That's a lender-paid 1-0 buydown worth ${money(bd.subsidyTotal)}
        in total, and it is a fixed-term subsidy, not a rate. From the
        ${dateLabel('2027-09-01')} payment onward the note rate of ${pct(m.rate * 100, 3)}
        applies in full.</p>
      </div>
    </div>
    <div class="alert alert--serious">
      <div class="alert-when">Next reassessment</div>
      <div>
        <h4>Escrow is funded on the pre-sale tax bill</h4>
        <p>Your escrow collects ${money2(m.escrow.propertyTaxMonthly)}/mo for property tax —
        ${money(D.house.taxCheck.escrowTaxAnnual)} a year, which is the 2025 assessment on this
        house <em>before</em> it sold and before the renovation. A ${money(re.purchasePrice)}
        purchase in Maricopa County is more likely to be billed around
        ${money(D.house.taxCheck.likelyTaxAnnual)} a year. Expect a shortage notice and roughly
        ${money(D.house.taxCheck.escrowGap)}/mo more once the county catches up.</p>
      </div>
    </div>
    <div class="alert alert--sum">
      <div class="alert-when">Both together</div>
      <div>
        <h4>Plan for about ${money(bd.monthlySubsidy + D.house.taxCheck.escrowGap)}/mo more by late 2027</h4>
        <p>That takes the payment from ${money(bd.borrowerPI + m.escrow.totalMonthly)} to roughly
        ${money(m.monthlyPI + m.escrow.totalMonthly + D.house.taxCheck.escrowGap)} — about
        ${pct(((m.monthlyPI + m.escrow.totalMonthly + D.house.taxCheck.escrowGap)
    / D.headline.statedMonthlyNet) * 100, 0)} of current take-home, up from
        ${pct(D.headline.housingRatio, 0)}. Neither change is a surprise and neither is
        negotiable, so the useful move is to start setting the difference aside now.</p>
      </div>
    </div>
  </section>`));

  // Amortisation
  const sched = m.schedule;
  const years = sched.filter((r) => r.n % 12 === 0);
  root.append(figure(
    'Paying it down',
    `${money(m.totalInterest)} of interest over the full term if you never overpay. `
    + `The balance crosses half way in ${monthLong(sched.find((r) => r.balance < m.originalPrincipal / 2)?.month ?? sched.at(-1).month)}.`,
    (plot, leg) => {
      lineChart(plot, {
        labels: years.map((r) => r.month.slice(0, 4)),
        height: 260,
        xEvery: 2,
        series: [
          { name: 'Balance owed', values: years.map((r) => r.balance), color: 's1', fill: true },
          { name: 'Equity, at flat value', values: years.map((r) => re.value - r.balance), color: 's3' },
        ],
        yFmt: compact,
        tipFmt: money,
        tipLabel: (i) => `Year ${i + 1} · ${monthLong(years[i].month)}`,
      });
      legend(leg, [
        { name: 'Balance owed', color: 's1' },
        { name: 'Equity, at flat value', color: 's3' },
      ]);
    },
    () => chartTable(['Payment', 'Month', 'Principal', 'Interest', 'Balance'],
      sched.slice(0, 60).map((r) => [r.n, monthLong(r.month), money2(r.principal),
        money2(r.interest), money(r.balance)])),
  ));

  // The transition ledger.
  const repaid = (D.privateLoans ?? []).filter((l) => l.repaidOn && l.repaidOn <= D.meta.asOf);
  if (repaid.length) {
    root.append(h('<h3 class="section-head">Borrowed and repaid</h3>'));
    for (const l of repaid) {
      root.append(h(`<div class="alert alert--sum">
        <div class="alert-when">${dateShort(l.borrowedOn)} → ${dateShort(l.repaidOn)}</div>
        <div>
          <h4>${esc(l.name)} — ${money(l.amount)}, cleared</h4>
          <p>${esc(l.note)}</p>
        </div>
      </div>`));
    }
  }

  root.append(h('<h3 class="section-head">The move, in money</h3>'));
  const tl = h('<ol class="timeline"></ol>');
  for (const e of D.oneTimeEvents) {
    tl.append(h(`<li class="tl-item${e.amount < 0 ? ' tl-item--out' : ' tl-item--in'}">
      <div class="tl-date">${dateLabel(e.date)}</div>
      <div class="tl-body">
        <div class="tl-head"><b>${esc(e.label)}</b><span class="tl-amt">${money(e.amount)}</span></div>
        ${e.note ? `<p class="tl-note">${esc(e.note.replace(/^UNRESOLVED:\s*/, ''))}</p>` : ''}
      </div>
    </li>`));
  }
  root.append(tl);

  // Projects
  root.append(h('<h3 class="section-head">Projects since closing</h3>'));
  const done = D.house.projects.filter((p) => p.status === 'done');
  const pending = D.house.projects.filter((p) => p.status !== 'done');
  const doneTotal = done.reduce((s, p) => s + (p.matchedTotal || p.amount), 0);

  const projGrid = h('<div class="proj-grid"></div>');
  for (const p of [...done, ...pending]) {
    const amt = p.matchedTotal || p.amount;
    projGrid.append(h(`
      <div class="proj proj--${p.status}">
        <div class="proj-head">
          <span class="proj-name">${esc(p.name)}</span>
          <span class="pill pill--${p.status}">${p.status}</span>
        </div>
        <div class="proj-amt">${amt ? money(amt) : '—'}</div>
        ${p.note ? `<p class="proj-note">${esc(p.note)}</p>` : ''}
        ${p.matched?.length ? `<div class="proj-tx muted">${p.matched.slice(0, 3).map((t) =>
    `${dateShort(t.date)} ${money(t.amount)}`).join(' · ')}</div>` : ''}
      </div>`));
  }
  root.append(h(`<p class="lede">${money(doneTotal)} spent so far on ${done.length} finished
    items, with ${pending.length} still quoted or planned.</p>`));
  root.append(projGrid);

  // Sinking funds
  const sf = D.house.sinkingFunds.targets;
  const sfTotal = sf.reduce((s, x) => s + x.annual, 0);
  root.append(h('<h3 class="section-head">Reserves worth funding</h3>'));
  root.append(h(`<p class="lede">A 1963 house with a pool, two HVAC systems and a
    ${(re.lotSqft / 43560).toFixed(2)}-acre lot. Renovated, but renovation resets the clock
    rather than stopping it. Setting aside ${money(sfTotal / 12)}/mo — ${money(sfTotal)} a year —
    covers the systems most likely to ask for money first.</p>`));
  const sfList = h('<div class="table-wrap"><table class="data-table"><thead><tr><th>Reserve</th><th class="num">Per year</th><th class="num">Per month</th><th>Why</th></tr></thead><tbody></tbody></table></div>');
  const tb = sfList.querySelector('tbody');
  for (const s of sf) {
    tb.append(h(`<tr><td>${esc(s.name)}</td><td class="num">${money(s.annual)}</td>
      <td class="num">${money(s.annual / 12)}</td><td class="muted">${esc(s.note ?? '')}</td></tr>`));
  }
  tb.append(h(`<tr class="tr-total"><td><b>Total</b></td><td class="num"><b>${money(sfTotal)}</b></td>
    <td class="num"><b>${money(sfTotal / 12)}</b></td><td></td></tr>`));
  root.append(sfList);

  return root;
}

// ═══ VIEW: Transactions ═════════════════════════════════════════════════════

const txState = { q: '', account: '', category: '', flow: 'expense', limit: 150 };

function viewTransactions() {
  const root = document.createElement('div');
  root.append(h(`<div class="view-intro">
    <h2>Transactions</h2>
    <p>${D.meta.txCount.toLocaleString()} rows, ${dateLabel(D.meta.firstDate)} to
    ${dateLabel(D.meta.lastDate)} — Mint through ${dateLabel(D.meta.sources.seam)},
    Simplifi after.</p>
  </div>`));

  const accounts = [...new Set(LEDGER.map((t) => t.account))].sort();
  const categories = [...new Set(LEDGER.map((t) => (t.category || 'Uncategorized').split(':')[0]))].sort();

  const bar = h(`<div class="filters">
    <input type="search" class="filter-input" placeholder="Search payee or category…" aria-label="Search transactions">
    <select class="filter-select" aria-label="Flow">
      <option value="">All flows</option>
      <option value="expense">Spending</option>
      <option value="income">Income</option>
      <option value="savings">Saved / invested</option>
      <option value="transfer">Transfers</option>
    </select>
    <select class="filter-select filter-account" aria-label="Account">
      <option value="">All accounts</option>
      ${accounts.map((a) => `<option>${esc(a)}</option>`).join('')}
    </select>
    <select class="filter-select filter-category" aria-label="Category">
      <option value="">All categories</option>
      ${categories.map((c) => `<option>${esc(c)}</option>`).join('')}
    </select>
  </div>`);
  root.append(bar);

  const summary = h('<p class="tx-summary muted"></p>');
  root.append(summary);
  const wrap = h(`<div class="table-wrap"><table class="data-table data-table--tx">
    <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Account</th><th class="num">Amount</th></tr></thead>
    <tbody></tbody></table></div>`);
  root.append(wrap);
  const more = h('<button type="button" class="ghost-btn more-btn">Show more</button>');
  root.append(more);

  const q = bar.querySelector('.filter-input');
  const [flowSel, acctSel, catSel] = bar.querySelectorAll('.filter-select');
  q.value = txState.q;
  flowSel.value = txState.flow;
  acctSel.value = txState.account;
  catSel.value = txState.category;

  const render = () => {
    const needle = txState.q.toLowerCase();
    const rows = LEDGER.filter((t) => {
      if (txState.flow && t.flow !== txState.flow) return false;
      if (txState.account && t.account !== txState.account) return false;
      if (txState.category
        && (t.category || 'Uncategorized').split(':')[0] !== txState.category) return false;
      if (needle && !(`${t.payee} ${t.category}`.toLowerCase().includes(needle))) return false;
      return true;
    }).reverse();

    const total = rows.reduce((s, t) => s + t.amount, 0);
    summary.innerHTML = `${rows.length.toLocaleString()} transactions · net `
      + `<b class="${total < 0 ? 'neg' : 'pos'}">${money2(total)}</b>`;

    const tb = wrap.querySelector('tbody');
    tb.innerHTML = '';
    for (const t of rows.slice(0, txState.limit)) {
      tb.append(h(`<tr>
        <td class="tx-date">${dateLabel(t.date)}</td>
        <td>${esc(t.payee)}</td>
        <td><span class="cell-dot c-${catColor((t.category || '').split(':')[0])}"></span>
          <span class="muted">${esc(t.category || 'Uncategorized')}</span></td>
        <td class="muted">${esc(t.account)}</td>
        <td class="num ${t.amount < 0 ? 'neg' : 'pos'}">${money2(t.amount)}</td>
      </tr>`));
    }
    more.hidden = rows.length <= txState.limit;
    more.textContent = `Show more (${(rows.length - txState.limit).toLocaleString()} remaining)`;
  };

  let debounce;
  q.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { txState.q = q.value; txState.limit = 150; render(); }, 140);
  });
  flowSel.addEventListener('change', () => { txState.flow = flowSel.value; txState.limit = 150; render(); });
  acctSel.addEventListener('change', () => { txState.account = acctSel.value; txState.limit = 150; render(); });
  catSel.addEventListener('change', () => { txState.category = catSel.value; txState.limit = 150; render(); });
  more.addEventListener('click', () => { txState.limit += 300; render(); });

  render();
  return root;
}

// ═══ Shell ══════════════════════════════════════════════════════════════════

const VIEWS = {
  overview: { label: 'Overview', render: viewOverview },
  cashflow: { label: 'Cash flow', render: viewCashflow },
  paycheck: { label: 'Paycheck', render: viewPaycheck },
  spending: { label: 'Spending', render: viewSpending },
  recurring: { label: 'Recurring', render: viewRecurring },
  accounts: { label: 'Balance sheet', render: viewAccounts },
  house: { label: 'The house', render: viewHouse },
  transactions: { label: 'Transactions', render: viewTransactions },
};

let currentView = 'overview';

function go(view, focus) {
  if (!VIEWS[view]) return;
  currentView = view;
  if (focus) spendingFocus = focus;
  location.hash = view;
  paint();
}

function paint() {
  const main = document.getElementById('fin-main');
  main.innerHTML = '';
  main.append(VIEWS[currentView].render());
  main.scrollTop = 0;
  for (const b of document.querySelectorAll('.nav-btn')) {
    b.setAttribute('aria-current', b.dataset.view === currentView ? 'page' : 'false');
  }
  window.scrollTo({ top: 0 });
}

function buildShell() {
  document.getElementById('fin-gate').hidden = true;
  const app = document.getElementById('fin-app');
  app.hidden = false;

  const nav = document.getElementById('fin-nav');
  for (const [key, v] of Object.entries(VIEWS)) {
    const b = h(`<button type="button" class="nav-btn" data-view="${key}">${v.label}</button>`);
    b.addEventListener('click', () => go(key));
    nav.append(b);
  }

  document.getElementById('fin-asof').textContent = `Data through ${dateLabel(D.meta.asOf)}`;

  const fromHash = location.hash.slice(1);
  if (VIEWS[fromHash]) currentView = fromHash;
  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (VIEWS[v] && v !== currentView) { currentView = v; paint(); }
  });

  // Tooltips on the little "?" affordances.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.info');
    document.querySelectorAll('.info-pop').forEach((p) => p.remove());
    if (!btn) return;
    e.preventDefault();
    const pop = h(`<div class="info-pop" role="status">${esc(btn.dataset.note)}</div>`);
    btn.after(pop);
  });

  paint();
}

// ── Unlock flow ─────────────────────────────────────────────────────────────

async function boot() {
  const form = document.getElementById('fin-unlock');
  const input = document.getElementById('fin-pass');
  const status = document.getElementById('fin-status');
  const submit = form.querySelector('button[type=submit]');

  let envelope = null;
  const envelopePromise = fetch('/finances/data.enc.json', { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(`Could not load the encrypted data (${r.status}).`);
      return r.json();
    })
    .then((j) => { envelope = j; })
    .catch((e) => { status.textContent = e.message; status.dataset.tone = 'error'; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value) return;
    submit.disabled = true;
    input.disabled = true;
    status.dataset.tone = 'busy';
    status.textContent = 'Deriving key…';

    await envelopePromise;
    if (!envelope) { submit.disabled = false; input.disabled = false; return; }

    // Yield to the event loop so the status paints before PBKDF2 blocks the
    // thread. Deliberately a timeout rather than rAF — rAF never fires in a
    // background tab, which would leave the unlock hung at "Deriving key…".
    await new Promise((r) => setTimeout(r, 24));

    try {
      const t0 = performance.now();
      D = await unlock(envelope, input.value);
      LEDGER = expandLedger(D.ledger, D.meta.dayZero);
      assignCategoryColours(D.categories.t12);
      status.dataset.tone = 'ok';
      status.textContent = `Unlocked in ${((performance.now() - t0) / 1000).toFixed(1)}s`;
      input.value = '';
      buildShell();
    } catch (err) {
      status.dataset.tone = 'error';
      status.textContent = err.code === 'WRONG_PASSPHRASE'
        ? 'That passphrase does not decrypt this file.'
        : err.message;
      submit.disabled = false;
      input.disabled = false;
      input.focus();
      input.select();
    }
  });

  input.focus();
}

// Theme toggle, remembered per browser. Wrapped because storage throws outright
// in some privacy modes rather than merely returning null.
function initTheme() {
  const btn = document.getElementById('fin-theme');
  const read = () => { try { return localStorage.getItem('fin-theme'); } catch { return null; } };
  const write = (v) => { try { localStorage.setItem('fin-theme', v); } catch { /* fine */ } };
  const saved = read();
  if (saved) document.documentElement.dataset.theme = saved;
  btn?.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark'
      || (!document.documentElement.dataset.theme
        && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    write(next);
  });
}

initTheme();
boot();
