// Configuration: every knob, one place, with defaults that work unconfigured.
// Loaded from waterfall.config.json (or the path in WATERFALL_CONFIG), then
// merged over these defaults. Unknown keys are reported rather than ignored, so
// a typo in a config file does not silently do nothing.
import { readFileSync, existsSync } from "node:fs";

export const DEFAULTS = {
  // --- what to survey ---
  days: 180,                    // survey window
  source: "git",                // "git" (local repos) | "github" (API)
  scanRoot: ".",                // for source "git": directory containing repos
  user: "",                     // for source "github": account to attribute commits to
  includePrivate: true,         // requires a token; names are never published
  exclude: [],                  // repo names to skip entirely
  minCommits: 1,                // ignore emitters quieter than this

  // --- how emitters are identified ---
  emitters: {
    anonymize: true,            // publish hash designators instead of repo names
    prefix: "E-",
    hashLength: 4,
    publicNames: [],            // these repos are named even when anonymising
  },

  // --- the band ---
  band: { lo: 3000, hi: 30000, unit: "kHz", axisUnit: "MHz", axisDivisor: 1000, tick: 3000 },

  // --- signal model ---
  signal: {
    dbFloor: -30,               // displayed dynamic range, in dB below the peak day
    noise: 0.10,                // noise floor amplitude, 0..1
    carrier: 0.13,              // faint on-air level for days with no commits
    liveDays: 7,                // days folded into the LIVE spectrum trace
    bins: 320,                  // frequency resolution
    metric: "commits",          // "commits" | "lines"
  },

  // --- time axis: bands of (days, pixels-per-day), newest first ---
  // A single linear band is the classic waterfall; multiple bands expand recent
  // activity so it is not compressed into a few invisible pixels.
  timeAxis: [
    { days: 7, px: 8 },
    { days: 23, px: 3 },
    { days: 150, px: 1.4 },
  ],

  // --- appearance ---
  palette: "sdrpp",             // sdrpp | viridis | phosphor | amber | inferno | custom
  customPalette: null,          // [[r,g,b], ...] used when palette === "custom"
  layout: {
    width: 860, pad: 26, axisWidth: 56, plotWidth: 640,
    spectrumHeight: 150, colorbar: true, colorbarWidth: 10,
    bookmarks: true, bookmarkMaxRows: 5,
  },
  theme: {
    light: { bg: "#FBFAF8", ink: "#111", muted: "#8A8578", tick: "#A9A497", accent: "#C2410C" },
    dark:  { bg: "#0B0B0A", ink: "#EDEAE3", muted: "#7C7768", tick: "#4A463E", accent: "#F97316" },
    scope: { bg: "#050A24", grid: "#2E4272", live: "#2E6ADB", liveLine: "#9FE4FF",
             hold: "#8FA8D8", frame: "#4A5B86", bookmark: "#F2E34C", bookmarkInk: "#141200" },
  },

  // --- optional encoded ident line ---
  ident: {
    enabled: false,
    text: "",
    groupSize: 5,
    perRow: 9,
    seed: "",                   // empty = derived from the busiest emitter's HEAD
    showFormula: true,
  },

  // --- output ---
  output: { svg: "console.svg", readme: "README.md", writeReadme: true },
};

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function merge(base, over, path, unknown) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in base)) { unknown.push(p); out[k] = v; continue; }
    out[k] = isPlainObject(base[k]) && isPlainObject(v) ? merge(base[k], v, p, unknown) : v;
  }
  return out;
}

const fail = (msg) => { throw new Error(`config: ${msg}`); };

export function validate(c) {
  if (!Number.isFinite(c.days) || c.days < 1) fail("days must be a positive number");
  if (!["git", "github"].includes(c.source)) fail(`source must be "git" or "github", got ${JSON.stringify(c.source)}`);
  if (c.source === "github" && !c.user) fail('source "github" requires "user"');
  if (c.band.hi <= c.band.lo) fail("band.hi must exceed band.lo");
  if (c.signal.dbFloor >= 0) fail("signal.dbFloor must be negative");
  if (!["commits", "lines"].includes(c.signal.metric)) fail('signal.metric must be "commits" or "lines"');
  if (!Array.isArray(c.timeAxis) || c.timeAxis.length === 0) fail("timeAxis must be a non-empty array");
  for (const [i, b] of c.timeAxis.entries()) {
    if (!Number.isFinite(b.days) || b.days < 1) fail(`timeAxis[${i}].days must be a positive number`);
    if (!Number.isFinite(b.px) || b.px <= 0) fail(`timeAxis[${i}].px must be > 0`);
  }
  const spanned = c.timeAxis.reduce((s, b) => s + b.days, 0);
  if (spanned > c.days) fail(`timeAxis covers ${spanned} d but days is ${c.days}`);
  if (c.palette === "custom") {
    if (!Array.isArray(c.customPalette) || c.customPalette.length < 2) {
      fail('palette "custom" requires customPalette with at least 2 [r,g,b] entries');
    }
  }
  if (c.ident.enabled && !c.ident.text) fail("ident.enabled requires ident.text");
  return c;
}

/** Resolve timeAxis into absolute row ranges, padding the last band to `days`. */
export function resolveBands(c) {
  const bands = [];
  let from = 0;
  for (const b of c.timeAxis) {
    bands.push({ from, to: from + b.days, px: b.px });
    from += b.days;
  }
  if (from < c.days) {
    const last = bands[bands.length - 1];
    last.to = c.days;             // stretch the coarsest band to cover the window
  }
  return bands;
}

export function load(path = process.env.WATERFALL_CONFIG || "waterfall.config.json") {
  let user = {};
  if (existsSync(path)) {
    try {
      user = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      fail(`${path} is not valid JSON - ${err.message}`);
    }
  }
  const unknown = [];
  const merged = merge(DEFAULTS, user, "", unknown);
  if (unknown.length) {
    console.warn(`config: unrecognised key${unknown.length > 1 ? "s" : ""} ignored by validation: ${unknown.join(", ")}`);
  }
  return validate(merged);
}
