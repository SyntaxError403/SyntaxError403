// Palettes, 64 steps each, sampled from control points.
const lerp = (a, b, t) => a + (b - a) * t;

function ramp(stops, n = 64) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
    const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    out.push([
      Math.round(lerp(c0[0], c1[0], u)),
      Math.round(lerp(c0[1], c1[1], u)),
      Math.round(lerp(c0[2], c1[2], u)),
    ]);
  }
  return out;
}

// Perceptually-ordered, dark noise floor rising to a hot signal peak.
export const VIRIDIS = ramp([
  [0.00, [8, 8, 12]], [0.12, [39, 26, 74]], [0.30, [56, 78, 127]],
  [0.50, [46, 121, 129]], [0.68, [69, 161, 106]], [0.84, [154, 195, 60]],
  [1.00, [253, 231, 37]],
]);

// Monochrome phosphor: black -> deep green -> bright green -> white hot.
export const PHOSPHOR = ramp([
  [0.00, [6, 8, 7]], [0.22, [12, 40, 22]], [0.48, [26, 105, 48]],
  [0.72, [72, 190, 92]], [0.90, [166, 235, 168]], [1.00, [236, 255, 236]],
]);

// Amber CRT, for the light-mode variant.
export const AMBER = ramp([
  [0.00, [10, 9, 7]], [0.24, [48, 28, 6]], [0.50, [124, 68, 8]],
  [0.74, [201, 124, 18]], [0.90, [240, 186, 76]], [1.00, [255, 240, 202]],
]);

// SDR++ "Classic": deep blue noise floor, light blue weak signals, white shoulder,
// yellow/orange/red on the strong carriers. Matches the reference receiver.
export const SDRPP = ramp([
  [0.00, [4, 10, 58]], [0.18, [14, 34, 132]], [0.34, [30, 84, 214]],
  [0.50, [96, 176, 250]], [0.62, [245, 250, 255]], [0.74, [255, 232, 74]],
  [0.86, [255, 148, 26]], [1.00, [224, 32, 20]],
]);

// Dark purple through red to pale yellow. Reads well on light backgrounds.
export const INFERNO = ramp([
  [0.00, [0, 0, 4]], [0.20, [40, 11, 84]], [0.40, [101, 21, 110]],
  [0.60, [159, 42, 99]], [0.75, [212, 72, 66]], [0.88, [245, 125, 21]],
  [1.00, [252, 255, 164]],
]);

export const PALETTES = { sdrpp: SDRPP, viridis: VIRIDIS, phosphor: PHOSPHOR, amber: AMBER, inferno: INFERNO };

/** Resolve a palette name (or a custom ramp) from config. */
export function resolvePalette(cfg) {
  if (cfg.palette === "custom") return ramp(
    cfg.customPalette.map((c, i, a) => [i / (a.length - 1), c])
  );
  const p = PALETTES[cfg.palette];
  if (!p) throw new Error(`config: unknown palette "${cfg.palette}" (have: ${Object.keys(PALETTES).join(", ")}, or "custom")`);
  return p;
}
