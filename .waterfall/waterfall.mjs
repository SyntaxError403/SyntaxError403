// Builds the power plane from commit history.
// X = frequency (each repository is an emitter occupying a band)
// Y = time, newest at top, one row per day
// intensity = signal power, a true dB ratio against the busiest single day
import { createHash } from "node:crypto";
import { resolveBands } from "./config.mjs";

const h32 = (s) => createHash("sha256").update(s).digest().readUInt32BE(0);

/** Deterministic value noise with vertical correlation - drifts like a real receiver floor. */
function noiseAt(x, y) {
  const a = h32(`n|${x}|${y >> 2}`) / 4294967296;
  const b = h32(`n|${x}|${(y >> 2) + 1}`) / 4294967296;
  const t = (y % 4) / 4;
  return (a * (1 - t) + b * t) * 0.65 + (h32(`f|${x}|${y}`) / 4294967296) * 0.35;
}

/**
 * Stable identifier for an emitter. Repository names are not published by
 * default: most people's are private, and a profile README is public.
 */
export function designate(name, cfg) {
  const e = cfg.emitters;
  if (!e.anonymize || e.publicNames.includes(name)) return name;
  return e.prefix + createHash("sha256").update(`emitter|${name}`).digest("hex")
    .slice(0, e.hashLength).toUpperCase();
}

/** Duty-cycle class, derived from the commit distribution. */
export function classify(times, first, last) {
  const days = new Set(times.map((t) => Math.floor(t / 86400))).size;
  const span = Math.max(1, Math.round((last - first) / 86400) + 1);
  if (times.length < 3 || span < 7) return "TRANSIENT";
  const duty = days / span;
  return duty > 0.5 ? "CONTINUOUS" : duty > 0.15 ? "INTERMITTENT" : "BURST";
}

/** Assign each repository a centre frequency bin, nudging apart on collision. */
export function assignFrequencies(repos, cfg) {
  const bins = cfg.signal.bins;
  const { lo, hi } = cfg.band;
  const taken = [];
  return repos.map((r) => {
    let bin = 8 + (h32(`freq|${r.name}`) % (bins - 16));
    let guard = 0;
    while (taken.some((t) => Math.abs(t - bin) < 9) && guard++ < 400) {
      bin = 8 + ((bin + 11) % (bins - 16));
    }
    taken.push(bin);
    const times = r.events.map((e) => e.t);
    return {
      ...r,
      bin,
      bw: Math.max(2, Math.round(Math.log10(r.total + 1) * 3.1)),
      freq: Math.round(lo + (bin / bins) * (hi - lo)),
      designator: designate(r.name, cfg),
      mode: classify(times, r.first, r.last),
    };
  }).sort((a, b) => a.bin - b.bin);
}

export function buildWaterfall(data, cfg, levels) {
  const w = cfg.signal.bins;
  const h = cfg.days;
  const DAY = 86400;
  const now = data.generated;
  const dayStart = (row) => now - (row + 1) * DAY;

  const emitters = assignFrequencies(data.repos, cfg);
  const useLines = cfg.signal.metric === "lines";

  // Bucket each emitter into day rows using the configured metric.
  const perEmitter = emitters.map((e) => {
    const rows = new Float64Array(h);
    for (const ev of e.events) {
      const row = Math.floor((now - ev.t) / DAY);
      if (row < 0 || row >= h) continue;
      rows[row] += useLines ? (ev.a || 0) + (ev.d || 0) : 1;
    }
    return { e, rows };
  });

  // Reference level: the busiest single day across every emitter. Power is a
  // true dB ratio against it, so peak height is proportional to real volume.
  let cmax = 0;
  for (const { rows } of perEmitter) for (const v of rows) if (v > cmax) cmax = v;
  cmax = Math.max(1, cmax);

  const floor = cfg.signal.dbFloor;
  const toP = (c) => {
    if (c <= 0) return 0;
    const db = 10 * Math.log10(c / cmax);
    return Math.max(0, Math.min(1, (db - floor) / (0 - floor)));
  };

  const power = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) power[y * w + x] = noiseAt(x, y) * cfg.signal.noise;
  }

  for (const { e, rows } of perEmitter) {
    const firstRow = Math.floor((now - e.last) / DAY);
    const lastRow = Math.floor((now - e.first) / DAY);
    for (let y = 0; y < h; y++) {
      // A faint carrier marks the emitter as on-air across its lifetime, so
      // project lifespan stays readable on days with no commits.
      const onAir = y >= firstRow - 1 && y <= lastRow + 1;
      const amp = Math.max(onAir ? cfg.signal.carrier : 0, toP(rows[y]));
      if (amp <= 0) continue;
      const half = e.bw / 2;
      for (let d = -Math.ceil(half) - 2; d <= Math.ceil(half) + 2; d++) {
        const x = e.bin + d;
        if (x < 0 || x >= w) continue;
        const u = Math.abs(d) / (half + 2);
        const shape = u >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * u));  // raised cosine
        const v = amp * shape;
        const i = y * w + x;
        if (v > power[i]) power[i] = Math.min(1, power[i] * 0.4 + v);
      }
    }
  }

  // Spectrum traces, taken from the same plane so the line chart and the
  // waterfall can never disagree.
  const maxHold = new Float64Array(w);
  const current = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let mh = 0, cur = 0;
    for (let y = 0; y < h; y++) {
      const v = power[y * w + x];
      if (v > mh) mh = v;
      if (y < cfg.signal.liveDays && v > cur) cur = v;
    }
    maxHold[x] = mh;
    current[x] = cur;
  }

  const indices = new Uint8Array(w * h);
  for (let i = 0; i < power.length; i++) {
    indices[i] = Math.max(0, Math.min(levels - 1, Math.round(power[i] * (levels - 1))));
  }

  const bands = resolveBands(cfg).map((b) => ({
    ...b,
    rows: Math.min(b.to, h) - b.from,
    indices: indices.subarray(b.from * w, Math.min(b.to, h) * w),
  })).filter((b) => b.rows > 0);

  return { indices, bands, w, h, emitters, dayStart, maxHold, current, cmax, metric: cfg.signal.metric };
}

export const bandHeight = (b) => b.rows * b.px;
export const totalHeight = (bands) => bands.reduce((s, b) => s + bandHeight(b), 0);

/** Pixel y-offset of a day row within the stacked bands. */
export function rowToY(bands, row) {
  let y = 0;
  for (const b of bands) {
    if (row < b.to) return y + (row - b.from) * b.px;
    y += bandHeight(b);
  }
  return y;
}
