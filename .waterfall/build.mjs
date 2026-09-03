import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderConsole } from "./render.mjs";
import { encode, groups } from "./numbers.mjs";

/** Substitute survey figures into the ident line. */
export function expandTokens(text, data) {
  const loc = data.loc || { added: 0, removed: 0 };
  const events = data.repos.reduce((s, r) => s + r.total, 0);
  return text
    .replace(/\{added\}/g, loc.added)
    .replace(/\{removed\}/g, loc.removed)
    .replace(/\{emitters\}/g, data.repos.length)
    .replace(/\{events\}/g, events)
    .replace(/\{days\}/g, data.days);
}

function identBlocks(data, cfg) {
  const text = expandTokens(cfg.ident.text, data);
  const seed = cfg.ident.seed || (data.repos[0]?.head || "").slice(0, 8) || "00000000";
  const gs = groups(encode(text, seed), cfg.ident.groupSize);
  const per = cfg.ident.perRow;

  const rows = Array.from({ length: Math.ceil(gs.length / per) },
    (_, i) => gs.slice(i * per, i * per + per).join(" & ")).join(" \\\\\n");

  // KaTeX - which is what GitHub renders math with - does not implement the
  // *{n}{c} column-repeat spec, so the columns are written out.
  let out = "\n```math\n\\begin{array}{" + "c".repeat(per) + "}\n" + rows + "\n\\end{array}\n```\n";
  if (cfg.ident.showFormula) {
    out += "\n```math\n\\small c_i \\equiv p_i + k_i \\pmod{10} \\qquad k = \\operatorname{SHA256}(s \\mathbin\\Vert i) \\bmod 10\n```\n";
  }
  return { out, count: gs.length, seed, text };
}

export function build(data, cfg) {
  const { svg } = renderConsole(data, cfg);
  const svgPath = resolve(cfg.output.svg);
  mkdirSync(dirname(svgPath), { recursive: true });
  writeFileSync(svgPath, svg);

  const result = { svg: cfg.output.svg, bytes: svg.length, emitters: data.repos.length };

  if (cfg.output.writeReadme) {
    const alt = `Wideband survey: ${data.repos.length} emitters over ${cfg.days} days`;
    let md = `<img src="${cfg.output.svg}" width="100%" alt="${alt}">\n`;
    if (cfg.ident.enabled) {
      const id = identBlocks(data, cfg);
      md += id.out;
      result.groups = id.count;
      result.seed = id.seed;
      result.ident = id.text;
    }
    md += `\n<sub>${cfg.days} d survey · ${data.repos.length} emitters · regenerated nightly</sub>\n`;
    const mdPath = resolve(cfg.output.readme);
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, md);
    result.readme = cfg.output.readme;
  }

  return result;
}
