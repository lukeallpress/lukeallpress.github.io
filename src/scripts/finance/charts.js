/**
 * Hand-rolled SVG chart primitives.
 *
 * No chart library: the page is served from a static GitHub Pages site and
 * every byte is passphrase-gated, so pulling a 200 KB dependency to draw
 * fifteen rectangles would be a poor trade. These follow one house style —
 * thin marks, recessive grid, rounded data-ends, a crosshair tooltip on
 * anything time-shaped, and a table fallback for every chart.
 */

const NS = 'http://www.w3.org/2000/svg';

export const el = (name, attrs = {}, children = []) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    n.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
};

export const SERIES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

// ── Scales & ticks ──────────────────────────────────────────────────────────

const niceStep = (raw) => {
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
};

/** Axis bounds that land on round numbers and always include zero. */
export function niceScale(min, max, targetTicks = 5) {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (lo === hi) { hi = lo + 1; }
  const step = niceStep((hi - lo) / targetTicks);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

// ── Shared chart frame ──────────────────────────────────────────────────────

function frame(root, { width, height, pad, yScale, xLabels, yFmt, xEvery }) {
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    class: 'chart-svg',
    role: 'img',
  });
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const y = (v) => pad.t + plotH * (1 - (v - yScale.lo) / (yScale.hi - yScale.lo));

  const grid = el('g', { class: 'chart-grid' });
  for (const t of yScale.ticks) {
    const yy = y(t);
    grid.append(el('line', {
      x1: pad.l, x2: width - pad.r, y1: yy, y2: yy,
      class: t === 0 ? 'chart-zero' : 'chart-gridline',
    }));
    grid.append(el('text', {
      x: pad.l - 8, y: yy + 4, class: 'chart-tick chart-tick-y',
    }, yFmt(t)));
  }
  svg.append(grid);

  if (xLabels) {
    const every = xEvery ?? Math.max(1, Math.ceil(xLabels.length / 8));
    const last = xLabels.length - 1;
    const xs = el('g', { class: 'chart-xaxis' });
    xLabels.forEach((lab, i) => {
      // Always label the final point, but drop the tick before it if the two
      // would sit on top of each other.
      if (i !== last && i % every !== 0) return;
      if (i !== last && last - i < every * 0.7) return;
      xs.append(el('text', {
        x: pad.l + (plotW * (i + 0.5)) / xLabels.length,
        y: height - pad.b + 16,
        class: 'chart-tick chart-tick-x',
      }, lab));
    });
    svg.append(xs);
  }

  root.append(svg);
  return { svg, plotW, plotH, y, pad, width, height };
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

function makeTooltip(host) {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  host.append(tip);
  return {
    show(html, xPct) {
      tip.innerHTML = html;
      tip.hidden = false;
      tip.style.left = `${Math.min(88, Math.max(12, xPct * 100))}%`;
      tip.dataset.side = xPct > 0.6 ? 'left' : 'right';
    },
    hide() { tip.hidden = true; },
  };
}

// ── Line / area chart over time ─────────────────────────────────────────────

/**
 * @param {object} o
 * @param {string[]} o.labels        x labels, one per point
 * @param {{name,values,color,fill}[]} o.series
 */
export function lineChart(host, o) {
  host.innerHTML = '';
  const width = 1000;
  const height = o.height ?? 300;
  const pad = { t: 14, r: 16, b: 28, l: o.padLeft ?? 62 };

  const all = o.series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  const yScale = niceScale(Math.min(...all), Math.max(...all), o.ticks ?? 5);
  const f = frame(host, {
    width, height, pad, yScale, xLabels: o.labels,
    yFmt: o.yFmt, xEvery: o.xEvery,
  });

  const n = o.labels.length;
  const x = (i) => pad.l + (f.plotW * (n === 1 ? 0.5 : i / (n - 1)));

  for (const [si, s] of o.series.entries()) {
    const cls = s.color ?? SERIES[si % SERIES.length];
    const pts = s.values.map((v, i) => `${x(i)},${f.y(v)}`);

    if (s.fill) {
      f.svg.append(el('path', {
        d: `M ${x(0)},${f.y(yScale.lo)} L ${pts.join(' L ')} L ${x(n - 1)},${f.y(yScale.lo)} Z`,
        class: `chart-area c-${cls}`,
      }));
    }
    f.svg.append(el('path', {
      d: `M ${pts.join(' L ')}`,
      class: `chart-line c-${cls}`,
      'vector-effect': 'non-scaling-stroke',
    }));
    // Terminal dot: the one point worth marking without cluttering the line.
    const lastI = s.values.length - 1;
    f.svg.append(el('circle', {
      cx: x(lastI), cy: f.y(s.values[lastI]), r: 4.5,
      class: `chart-dot c-${cls}`,
    }));
  }

  // Crosshair layer
  const cross = el('line', { class: 'chart-cross', y1: pad.t, y2: height - pad.b });
  cross.style.opacity = '0';
  f.svg.append(cross);
  const marks = o.series.map((s, si) => {
    const c = el('circle', { r: 5, class: `chart-cursor c-${s.color ?? SERIES[si % SERIES.length]}` });
    c.style.opacity = '0';
    f.svg.append(c);
    return c;
  });

  const tip = makeTooltip(host);
  const hit = el('rect', {
    x: pad.l, y: pad.t, width: f.plotW, height: f.plotH, fill: 'transparent',
  });
  f.svg.append(hit);

  const move = (ev) => {
    const box = f.svg.getBoundingClientRect();
    const px = ((ev.clientX ?? ev.touches?.[0]?.clientX) - box.left) / box.width * width;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / f.plotW) * (n - 1))));
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.style.opacity = '1';
    marks.forEach((m, si) => {
      m.setAttribute('cx', x(i));
      m.setAttribute('cy', f.y(o.series[si].values[i]));
      m.style.opacity = '1';
    });
    const rows = o.series.map((s, si) =>
      `<div class="tip-row"><span class="tip-swatch c-${s.color ?? SERIES[si % SERIES.length]}"></span>`
      + `<span class="tip-name">${s.name}</span>`
      + `<span class="tip-val">${o.tipFmt(s.values[i])}</span></div>`).join('');
    tip.show(`<div class="tip-head">${o.tipLabel?.(i) ?? o.labels[i]}</div>${rows}`, (x(i) - pad.l) / f.plotW);
  };
  const leave = () => {
    cross.style.opacity = '0';
    marks.forEach((m) => { m.style.opacity = '0'; });
    tip.hide();
  };
  f.svg.addEventListener('pointermove', move);
  f.svg.addEventListener('pointerleave', leave);
  f.svg.addEventListener('touchmove', move, { passive: true });

  return f;
}

// ── Column chart (single or diverging pair) ─────────────────────────────────

export function columnChart(host, o) {
  host.innerHTML = '';
  const width = 1000;
  const height = o.height ?? 260;
  const pad = { t: 14, r: 16, b: 28, l: o.padLeft ?? 62 };

  const all = o.series.flatMap((s) => s.values);
  const yScale = niceScale(Math.min(...all, 0), Math.max(...all, 0), o.ticks ?? 4);
  const f = frame(host, {
    width, height, pad, yScale, xLabels: o.labels, yFmt: o.yFmt, xEvery: o.xEvery,
  });

  const n = o.labels.length;
  const slot = f.plotW / n;
  const k = o.series.length;
  // A 2px gap between adjacent bars keeps the surface visible between marks.
  const barW = Math.max(2, (slot * 0.72) / k - (k > 1 ? 2 : 0));
  const tip = makeTooltip(host);

  o.series.forEach((s, si) => {
    const cls = s.color ?? SERIES[si % SERIES.length];
    s.values.forEach((v, i) => {
      const x0 = pad.l + slot * i + slot * 0.14 + si * (barW + 2);
      const yTop = f.y(Math.max(0, v));
      const yBot = f.y(Math.min(0, v));
      const h = Math.max(1, Math.abs(yBot - yTop));
      const rect = el('rect', {
        x: x0, y: yTop, width: barW, height: h,
        rx: Math.min(4, barW / 2), class: `chart-bar c-${cls}`,
      });
      rect.addEventListener('pointerenter', () => {
        const rows = o.series.map((ss, sj) =>
          `<div class="tip-row"><span class="tip-swatch c-${ss.color ?? SERIES[sj % SERIES.length]}"></span>`
          + `<span class="tip-name">${ss.name}</span>`
          + `<span class="tip-val">${o.tipFmt(ss.values[i])}</span></div>`).join('');
        tip.show(`<div class="tip-head">${o.tipLabel?.(i) ?? o.labels[i]}</div>${rows}`,
          (x0 - pad.l) / f.plotW);
      });
      rect.addEventListener('pointerleave', () => tip.hide());
      f.svg.append(rect);
    });
  });

  return f;
}

// ── Stacked column chart ────────────────────────────────────────────────────

export function stackedChart(host, o) {
  host.innerHTML = '';
  const width = 1000;
  const height = o.height ?? 300;
  const pad = { t: 14, r: 16, b: 28, l: o.padLeft ?? 62 };

  const totals = o.labels.map((_, i) =>
    o.series.reduce((s, ser) => s + Math.max(0, ser.values[i]), 0));
  const yScale = niceScale(0, Math.max(...totals), o.ticks ?? 4);
  const f = frame(host, {
    width, height, pad, yScale, xLabels: o.labels, yFmt: o.yFmt, xEvery: o.xEvery,
  });

  const n = o.labels.length;
  const slot = f.plotW / n;
  const barW = slot * 0.72;
  const tip = makeTooltip(host);

  o.labels.forEach((_, i) => {
    let acc = 0;
    o.series.forEach((s, si) => {
      const v = Math.max(0, s.values[i]);
      if (v <= 0) return;
      const yTop = f.y(acc + v);
      const yBot = f.y(acc);
      acc += v;
      // 2px surface gap between stacked segments.
      const h = Math.max(1, yBot - yTop - 2);
      const rect = el('rect', {
        x: pad.l + slot * i + slot * 0.14, y: yTop, width: barW, height: h,
        rx: 2, class: `chart-bar c-${s.color ?? SERIES[si % SERIES.length]}`,
      });
      rect.addEventListener('pointerenter', () => {
        const rows = o.series.map((ss, sj) => ss.values[i] > 0
          ? `<div class="tip-row"><span class="tip-swatch c-${ss.color ?? SERIES[sj % SERIES.length]}"></span>`
            + `<span class="tip-name">${ss.name}</span>`
            + `<span class="tip-val">${o.tipFmt(ss.values[i])}</span></div>` : '').join('');
        tip.show(`<div class="tip-head">${o.tipLabel?.(i) ?? o.labels[i]}</div>${rows}`
          + `<div class="tip-total">Total ${o.tipFmt(totals[i])}</div>`,
        (pad.l + slot * i - pad.l) / f.plotW);
      });
      rect.addEventListener('pointerleave', () => tip.hide());
      f.svg.append(rect);
    });
  });

  return f;
}

// ── Horizontal ranked bars ──────────────────────────────────────────────────

export function rankedBars(host, rows, o = {}) {
  host.innerHTML = '';
  const max = Math.max(...rows.map((r) => r.value), 1);
  const list = document.createElement('div');
  list.className = 'ranked';

  for (const r of rows) {
    const item = document.createElement(o.onClick ? 'button' : 'div');
    item.className = 'ranked-row';
    if (o.onClick) {
      item.type = 'button';
      item.addEventListener('click', () => o.onClick(r));
    }
    item.innerHTML = `
      <span class="ranked-label">${r.label}</span>
      <span class="ranked-track">
        <span class="ranked-fill c-${r.color ?? 's1'}" style="width:${(r.value / max) * 100}%"></span>
      </span>
      <span class="ranked-value">${o.fmt ? o.fmt(r.value) : r.value}</span>
      ${r.meta ? `<span class="ranked-meta">${r.meta}</span>` : ''}`;
    list.append(item);
  }
  host.append(list);
}

// ── Sparkline ───────────────────────────────────────────────────────────────

export function sparkline(values, { width = 96, height = 24, color = 's1' } = {}) {
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'spark', 'aria-hidden': 'true',
  });
  if (!values.length) return svg;
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 1);
  const x = (i) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * width);
  const y = (v) => height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4);
  svg.append(el('path', {
    d: `M ${values.map((v, i) => `${x(i)},${y(v)}`).join(' L ')}`,
    class: `spark-line c-${color}`, 'vector-effect': 'non-scaling-stroke',
  }));
  return svg;
}

// ── Donut ───────────────────────────────────────────────────────────────────

export function donut(host, slices, o = {}) {
  host.innerHTML = '';
  const size = 200;
  const r = 78;
  const stroke = 26;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, class: 'donut' });

  let angle = -Math.PI / 2;
  slices.forEach((s, i) => {
    // 2px surface gap between neighbouring arcs.
    const sweep = (s.value / total) * Math.PI * 2;
    const gap = Math.min(sweep * 0.12, 0.035);
    const a0 = angle + gap / 2;
    const a1 = angle + sweep - gap / 2;
    angle += sweep;
    if (a1 <= a0) return;
    const p = (a) => [size / 2 + r * Math.cos(a), size / 2 + r * Math.sin(a)];
    const [x0, y0] = p(a0); const [x1, y1] = p(a1);
    svg.append(el('path', {
      d: `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`,
      class: `donut-arc c-${s.color ?? SERIES[i % SERIES.length]}`,
      'stroke-width': stroke, fill: 'none',
    }));
  });

  if (o.centerLabel) {
    svg.append(el('text', {
      x: size / 2, y: size / 2 - 2, class: 'donut-value', 'text-anchor': 'middle',
    }, o.centerValue ?? ''));
    svg.append(el('text', {
      x: size / 2, y: size / 2 + 18, class: 'donut-label', 'text-anchor': 'middle',
    }, o.centerLabel));
  }
  host.append(svg);
}

// ── Table fallback ──────────────────────────────────────────────────────────

/**
 * Every chart ships one of these behind a toggle. Three of the light-mode
 * series colours sit under 3:1 against warm paper, which makes the table a
 * requirement rather than a nicety.
 */
export function chartTable(headers, rows) {
  const t = document.createElement('table');
  t.className = 'chart-table';
  t.innerHTML = `<thead><tr>${headers.map((h, i) =>
    `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.map((r) => `<tr>${r.map((c, i) =>
      `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return t;
}
