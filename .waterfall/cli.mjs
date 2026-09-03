#!/usr/bin/env node
import { writeFileSync, existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { load, DEFAULTS } from "./config.mjs";
import { scanGit } from "./scan-git.mjs";
import { scanGitHub } from "./scan-github.mjs";
import { build } from "./build.mjs";

const DATA = process.env.WATERFALL_DATA || ".waterfall-data.json";
const [, , cmd = "help", ...rest] = process.argv;

const WORKFLOW = `name: waterfall

on:
  schedule:
    - cron: "17 5 * * *"     # nightly, 05:17 UTC
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: waterfall
  cancel-in-progress: true

jobs:
  survey:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Sweep and render
        env:
          # Fine-grained PAT, read-only Contents. Repository names are never
          # published when emitters.anonymize is true, so this can safely see
          # private repos. Omit it and set includePrivate:false for public only.
          GH_TOKEN: \${{ secrets.WATERFALL_TOKEN }}
        # Published package. Before publishing to npm, point this at the repo
        # instead:  npx -y github:<owner>/commit-waterfall all
        run: npx -y \${WATERFALL_PKG:-commit-waterfall@1} all

      - name: Commit if the band changed
        run: |
          if [ -z "$(git status --porcelain)" ]; then echo "no change"; exit 0; fi
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          git commit -m "waterfall: $(date -u +%Y-%m-%dT%H:%MZ)"
          git push
`;

async function scan(cfg) {
  const data = cfg.source === "github"
    ? await scanGitHub(cfg, process.env.GH_TOKEN)
    : scanGit(cfg);
  writeFileSync(DATA, JSON.stringify(data, null, 2));
  const events = data.repos.reduce((s, r) => s + r.total, 0);
  console.log(`scanned ${data.repos.length} emitters, ${events} events over ${cfg.days} d`);
  // A sweep that suddenly sees almost nothing usually means the token lost
  // access, not that the work stopped. Fail rather than publish a hollow page
  // over a good one.
  if (cfg.minEmitters && data.repos.length < cfg.minEmitters) {
    throw new Error(`sweep found ${data.repos.length} emitters, expected at least ${cfg.minEmitters} - ` +
      `refusing to publish. Check the token can still read your repositories, ` +
      `or lower minEmitters if this is genuine.`);
  }
  if (data.loc?.added) console.log(`net lines since ${data.loc.baseline}: +${data.loc.added} / -${data.loc.removed}`);
  return data;
}

function render(cfg) {
  if (!existsSync(DATA)) {
    console.error(`no survey data at ${DATA} - run "commit-waterfall scan" first`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(DATA, "utf8"));
  const r = build(data, cfg);
  console.log(`wrote ${r.svg} (${(r.bytes / 1024).toFixed(1)} KB)${r.readme ? ` and ${r.readme}` : ""}`);
  if (r.groups) console.log(`ident: ${r.groups} groups, seed ${r.seed}`);
  return r;
}

try {
  switch (cmd) {
    case "init": {
      if (existsSync("waterfall.config.json") && !rest.includes("--force")) {
        console.error("waterfall.config.json already exists (use --force to overwrite)");
        process.exit(1);
      }
      const starter = {
        days: DEFAULTS.days,
        source: "git",
        scanRoot: "..",
        palette: "sdrpp",
        emitters: { anonymize: true },
        ident: { enabled: false, text: "Your Name | {added}+ / {removed}- since last sweep" },
      };
      writeFileSync("waterfall.config.json", JSON.stringify(starter, null, 2) + "\n");
      mkdirSync(".github/workflows", { recursive: true });
      writeFileSync(".github/workflows/waterfall.yml", WORKFLOW);

      // The scan cache holds real repository names, including private ones.
      // Committing it would defeat the whole point of anonymised designators.
      const IGNORE = [".waterfall-data.json", ".waterfall-state.json"];
      const current = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
      const missing = IGNORE.filter((l) => !current.split("\n").includes(l));
      if (missing.length) {
        appendFileSync(".gitignore",
          (current && !current.endsWith("\n") ? "\n" : "") +
          "\n# commit-waterfall: contains real repository names, never commit\n" +
          missing.join("\n") + "\n");
      }
      console.log("wrote waterfall.config.json, .github/workflows/waterfall.yml" +
        (missing.length ? ", and .gitignore entries" : ""));
      console.log("next: commit-waterfall all");
      break;
    }
    case "scan":    await scan(load()); break;
    case "build":   render(load()); break;
    case "all":     { const cfg = load(); await scan(cfg); render(cfg); break; }
    case "serve":   { await import("./serve.mjs"); break; }
    case "config":  console.log(JSON.stringify(load(), null, 2)); break;
    default:
      console.log(`commit-waterfall - your commit history as an SDR spectrum waterfall

  init     write waterfall.config.json and a nightly workflow
  scan     read commit history into ${DATA}
  build    render the SVG (and README) from scanned data
  all      scan then build
  serve    local preview at http://localhost:8901
  config   print the resolved configuration

Config file: waterfall.config.json (override with WATERFALL_CONFIG)`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
