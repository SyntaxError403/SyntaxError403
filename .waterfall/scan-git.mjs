// Local scanner: reads git history from repositories on disk. No token needed.
import { readdirSync, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";

const GENERATED_EXCLUDES = [
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "*.lock",
  "dist/*", "build/*", "out/*", ".next/*", "node_modules/*", "vendor/*",
  "*.min.js", "*.min.css", "*.map", "*.snap",
];
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const sh = (cmd, timeout = 30000) =>
  execSync(cmd, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout });

export function scanGit(cfg, statePath = ".waterfall-state.json") {
  const root = resolve(cfg.scanRoot);
  const sinceSec = Math.floor(Date.now() / 1000) - cfg.days * 86400;
  const wantLines = cfg.signal.metric === "lines";

  // Baseline for the "lines since last run" figure.
  let sinceLoc, baseline;
  try {
    sinceLoc = JSON.parse(readFileSync(statePath, "utf8")).ts;
    baseline = "last run";
  } catch {
    sinceLoc = Math.floor(Date.now() / 1000) - 86400;
    baseline = "24h (no previous run)";
  }

  const exclude = GENERATED_EXCLUDES.map((g) => `':(exclude)${g}'`).join(" ");
  let locAdded = 0, locRemoved = 0;
  const repos = [];

  for (const name of readdirSync(root)) {
    if (cfg.exclude.includes(name)) continue;
    const dir = join(root, name);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    if (!existsSync(join(dir, ".git"))) continue;

    // Per-commit line counts are only worth the diff cost when actually used.
    const fmt = wantLines ? '--format=%x1e%at --shortstat' : '--format=%at';
    let out = "";
    try {
      out = sh(`git -C "${dir}" log --all --no-merges --since=${cfg.days}.days ${fmt} 2>/dev/null`);
    } catch { continue; }

    const events = [];
    if (wantLines) {
      for (const block of out.split("\x1e")) {
        if (!block.trim()) continue;
        const lines = block.split("\n");
        const t = Number(lines[0]);
        if (!Number.isFinite(t) || t < sinceSec) continue;
        const stat = lines.find((l) => l.includes("changed")) || "";
        const a = Number((stat.match(/(\d+) insertion/) || [])[1] || 0);
        const d = Number((stat.match(/(\d+) deletion/) || [])[1] || 0);
        events.push({ t, a, d });
      }
    } else {
      for (const l of out.split("\n")) {
        const t = Number(l.trim());
        if (Number.isFinite(t) && t >= sinceSec) events.push({ t, a: 0, d: 0 });
      }
    }
    if (events.length < cfg.minCommits) continue;
    events.sort((x, y) => x.t - y.t);

    // Net lines since the baseline. A single diff, not a sum of per-commit
    // diffs, which would count a file rewritten five times five separate times.
    try {
      let base = sh(`git -C "${dir}" rev-list -1 --before=${sinceLoc} HEAD 2>/dev/null`).trim() || EMPTY_TREE;
      const stat = sh(`git -C "${dir}" diff --shortstat ${base} HEAD -- . ${exclude} 2>/dev/null`);
      locAdded += Number((stat.match(/(\d+) insertion/) || [])[1] || 0);
      locRemoved += Number((stat.match(/(\d+) deletion/) || [])[1] || 0);
    } catch {}

    let head = "";
    try { head = sh(`git -C "${dir}" rev-parse HEAD`).trim(); } catch {}

    repos.push({
      name, head, private: true, events,
      total: events.length,
      first: events[0].t,
      last: events[events.length - 1].t,
    });
  }

  repos.sort((a, b) => b.total - a.total);
  const nowTs = Math.floor(Date.now() / 1000);
  mkdirSync(dirname(resolve(statePath)), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ ts: nowTs }, null, 2));

  return {
    generated: nowTs, days: cfg.days, repos,
    loc: { added: locAdded, removed: locRemoved, since: sinceLoc, baseline },
  };
}
