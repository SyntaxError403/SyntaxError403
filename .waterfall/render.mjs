// Renders the console as one self-contained SVG.
//
// Constraints, because GitHub serves this through camo inside an <img>:
//   - no external fonts, scripts, or stylesheets
//   - no pointer events, so nothing may depend on interaction
//   - CSS @media (prefers-color-scheme) DOES work in this context
// The waterfall rides along as embedded data: URI PNGs; everything else is
// vector so the text stays crisp at any zoom.
import { encodeIndexedPNG, dataURI } from "./png.mjs";
import { buildWaterfall, bandHeight, totalHeight, rowToY } from "./waterfall.mjs";
import { resolvePalette } from "./colormap.mjs";

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Greedy row packing so bookmark labels never overlap. */
function packBookmarks(items, maxRows, gap = 5) {
  const rows = [];
  for (const it of [...items].sort((a, b) => a.x0 - b.x0)) {
    let r = rows.findIndex((row) => row[row.length - 1].x1 + gap <= it.x0);
    if (r === -1) {
      if (rows.length >= maxRows) r = 0;
      else { rows.push([]); r = rows.length - 1; }
    }
    rows[r].push(it);
    it.row = r;
  }
  return rows.length;
}

export function renderConsole(data, cfg) {
  const palette = resolvePalette(cfg);
  const wf = buildWaterfall(data, cfg, palette.length);
  const L = cfg.layout;
  const T = cfg.theme;

  const wfH = totalHeight(wf.bands);
  const wfX = L.pad + L.axisWidth;
  const bmY = L.pad;

  const binToX = (bin) => wfX + (bin / wf.w) * L.plotWidth;

  // ---- bookmark labels ----
  let bmRows = 0;
  const bookmarks = L.bookmarks
    ? wf.emitters.map((e) => {
        const w = e.designator.length * 4.35 + 9;
        const cx = binToX(e.bin);
        const x0 = Math.max(wfX, Math.min(wfX + L.plotWidth - w, cx - w / 2));
        return { e, w, cx, x0, x1: x0 + w, row: 0 };
      })
    : [];
  if (bookmarks.length) bmRows = packBookmarks(bookmarks, L.bookmarkMaxRows);

  const specY = bmY + bmRows * 14 + (bmRows ? 8 : 0);
  const wfY = specY + L.spectrumHeight + 2;
  const freqY = wfY + wfH;
  const H = freqY + 34 + L.pad;
  const W = L.width;

  let marks = "";
  for (const b of bookmarks) {
    const y = bmY + b.row * 14;
    marks += `<line class="bmline" x1="${b.cx.toFixed(1)}" y1="${y + 10}" x2="${b.cx.toFixed(1)}" y2="${specY + L.spectrumHeight}"/>`;
    marks += `<rect class="bmbox" x="${b.x0.toFixed(1)}" y="${y}" width="${b.w.toFixed(1)}" height="10.5" rx="1"/>`;
    marks += `<text class="bmtext" x="${(b.x0 + b.w / 2).toFixed(1)}" y="${y + 8}">${esc(b.e.designator)}</text>`;
  }

  // ---- spectrum ----
  const DB_MIN = cfg.signal.dbFloor;
  const pToY = (p) => specY + L.spectrumHeight * (1 - Math.max(0, Math.min(1, p)));
  const trace = (arr) => "M" + Array.from(arr, (p, i) =>
    `${(wfX + (i / (arr.length - 1)) * L.plotWidth).toFixed(1)},${pToY(p).toFixed(1)}`).join("L");

  let spec = `<rect class="scope" x="${wfX}" y="${specY}" width="${L.plotWidth}" height="${L.spectrumHeight}"/>`;
  const step = Math.abs(DB_MIN) <= 40 ? 10 : 20;
  for (let db = DB_MIN + step; db < 0; db += step) {
    const y = specY + L.spectrumHeight * (1 - (db - DB_MIN) / (0 - DB_MIN));
    spec += `<line class="grid" x1="${wfX}" y1="${y.toFixed(1)}" x2="${wfX + L.plotWidth}" y2="${y.toFixed(1)}"/>`;
    spec += `<text class="ax ar" x="${wfX - 8}" y="${(y + 3).toFixed(1)}">${db}</text>`;
  }
  spec += `<text class="ax ar" x="${wfX - 8}" y="${specY + 8}">0</text>`;
  spec += `<path class="hold" d="${trace(wf.maxHold)}"/>`;
  spec += `<path class="live" d="${trace(wf.current)}L${(wfX + L.plotWidth).toFixed(1)},${(specY + L.spectrumHeight).toFixed(1)}L${wfX},${(specY + L.spectrumHeight).toFixed(1)}Z"/>`;
  spec += `<path class="liveline" d="${trace(wf.current)}"/>`;
  spec += `<rect class="frame" x="${wfX}" y="${specY}" width="${L.plotWidth}" height="${L.spectrumHeight}"/>`;
  spec += `<g transform="translate(${L.pad + 8},${specY + L.spectrumHeight / 2}) rotate(-90)"><text class="ax am">dB REL PEAK</text></g>`;
  spec += `<text class="lg ar" x="${wfX + L.plotWidth - 122}" y="${specY + 12}">LIVE ${cfg.signal.liveDays}d</text>`;
  spec += `<text class="lg hold-lg ar" x="${wfX + L.plotWidth - 8}" y="${specY + 12}">MAX HOLD ${cfg.days}d</text>`;

  // ---- waterfall, one image per time band ----
  let image = "";
  let bandY = wfY;
  wf.bands.forEach((b, i) => {
    const h = bandHeight(b);
    const png = encodeIndexedPNG(wf.w, b.rows, b.indices, palette);
    image += `<image x="${wfX}" y="${bandY.toFixed(1)}" width="${L.plotWidth}" height="${h.toFixed(1)}" ` +
      `preserveAspectRatio="none" image-rendering="pixelated" href="${dataURI(png)}"/>`;
    if (i < wf.bands.length - 1) {
      const yy = (bandY + h).toFixed(1);
      image += `<line class="scalebreak" x1="${wfX}" y1="${yy}" x2="${wfX + L.plotWidth}" y2="${yy}"/>`;
    }
    bandY += h;
  });

  // ---- time axis ----
  let timeAxis = "";
  let lastMonth = -1;
  for (let row = 0; row < wf.h; row++) {
    const d = new Date(wf.dayStart(row) * 1000);
    const m = d.getUTCMonth();
    if (m === lastMonth) continue;
    lastMonth = m;
    if (row < 2) continue;                     // NOW occupies the top
    const y = wfY + rowToY(wf.bands, row);
    timeAxis += `<line class="tick" x1="${wfX - 6}" y1="${y.toFixed(1)}" x2="${wfX}" y2="${y.toFixed(1)}"/>`;
    timeAxis += `<text class="ax ar" x="${wfX - 10}" y="${(y + 3).toFixed(1)}">${MONTHS[m]} ${String(d.getUTCFullYear()).slice(2)}</text>`;
  }
  timeAxis += `<text class="ax ar hot" x="${wfX - 10}" y="${wfY + 9}">NOW</text>`;
  // The axis is non-linear when multiple bands are configured; say so.
  if (wf.bands.length > 1) {
    let sy = wfY;
    for (const b of wf.bands) {
      const h = bandHeight(b);
      timeAxis += `<g transform="translate(${wfX + L.plotWidth + 5},${(sy + h / 2).toFixed(1)}) rotate(-90)"><text class="ax am">${b.px}px/d</text></g>`;
      sy += h;
    }
  }

  // ---- frequency axis ----
  let freqAxis = "";
  const { lo, hi, tick, axisUnit, axisDivisor } = cfg.band;
  for (let k = lo; k <= hi; k += tick) {
    const x = wfX + ((k - lo) / (hi - lo)) * L.plotWidth;
    freqAxis += `<line class="tick" x1="${x.toFixed(1)}" y1="${freqY}" x2="${x.toFixed(1)}" y2="${freqY + 5}"/>`;
    freqAxis += `<text class="ax am" x="${x.toFixed(1)}" y="${freqY + 16}">${(k / axisDivisor).toFixed(0)}</text>`;
  }
  freqAxis += `<text class="ax am" x="${wfX + L.plotWidth / 2}" y="${freqY + 29}">FREQUENCY / ${esc(axisUnit)}</text>`;

  // ---- colour bar ----
  let cbar = "";
  if (L.colorbar) {
    const cbX = wfX + L.plotWidth + (wf.bands.length > 1 ? 34 : 18);
    for (let i = 0; i < palette.length; i++) {
      const [r, g, b] = palette[palette.length - 1 - i];
      cbar += `<rect x="${cbX}" y="${(wfY + (i / palette.length) * wfH).toFixed(2)}" width="${L.colorbarWidth}" height="${(wfH / palette.length + 0.6).toFixed(2)}" fill="rgb(${r},${g},${b})"/>`;
    }
    cbar += `<rect class="frame" x="${cbX}" y="${wfY}" width="${L.colorbarWidth}" height="${wfH}"/>`;
    cbar += `<text class="ax" x="${cbX + L.colorbarWidth + 5}" y="${wfY + 4}">0</text>`;
    cbar += `<text class="ax" x="${cbX + L.colorbarWidth + 5}" y="${wfY + wfH}">${DB_MIN}</text>`;
  }

  const css = `
  .bgr{fill:${T.light.bg}}
  text{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
  .ax{fill:${T.light.muted};font-size:8px;letter-spacing:.6px}
  .hot{fill:${T.light.accent};font-weight:700}
  .tick{stroke:${T.light.tick};stroke-width:1}
  .scalebreak{stroke:${T.scope.bookmark};stroke-width:1;opacity:.5;stroke-dasharray:4 3}
  .frame{fill:none;stroke:${T.scope.frame};stroke-width:1}
  .ar{text-anchor:end}.am{text-anchor:middle}
  .scope{fill:${T.scope.bg}}
  .grid{stroke:${T.scope.grid};stroke-width:1;stroke-dasharray:2 3}
  .hold{fill:none;stroke:${T.scope.hold};stroke-width:.9;opacity:.75}
  .live{fill:${T.scope.live};opacity:.42}
  .liveline{fill:none;stroke:${T.scope.liveLine};stroke-width:1.1}
  .lg{fill:${T.scope.liveLine};font-size:7.5px;letter-spacing:1px}
  .hold-lg{fill:${T.scope.hold}}
  .bmbox{fill:${T.scope.bookmark}}
  .bmtext{fill:${T.scope.bookmarkInk};font-size:7px;font-weight:700;text-anchor:middle}
  .bmline{stroke:${T.scope.bookmark};stroke-width:.8;opacity:.55}
  @media (prefers-color-scheme:dark){
    .bgr{fill:${T.dark.bg}}
    .ax{fill:${T.dark.muted}}
    .hot{fill:${T.dark.accent}}
    .tick{stroke:${T.dark.tick}}
  }`.replace(/\n\s+/g, "");

  // The label must never carry anything the page is not already publishing.
  const label = `Wideband survey: ${data.repos.length} emitters, ${data.repos.reduce((s, r) => s + r.total, 0)} events over ${cfg.days} days`;

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${css}</style><rect class="bgr" x="0" y="0" width="${W}" height="${H}"/>${marks}${spec}${image}<rect class="frame" x="${wfX}" y="${wfY}" width="${L.plotWidth}" height="${wfH}"/>${timeAxis}${freqAxis}${cbar}</svg>`,
    wf,
  };
}
