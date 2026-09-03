// Local preview: renders the generated README the way GitHub does, KaTeX and
// all, rebuilding on every request so config edits show up on refresh.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { load } from "./config.mjs";
import { build } from "./build.mjs";

const PORT = Number(process.env.PORT || 8901);
const DATA = process.env.WATERFALL_DATA || ".waterfall-data.json";

const inline = (s) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/&lt;(\/?(?:sub|sup|b|i|em|strong|a|img)\b[^&]*?)&gt;/g, "<$1>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

function mdToHtml(src) {
  const lines = src.split("\n");
  let html = "", i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const buf = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      const body = buf.join("\n").replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"));
      html += lang === "math" ? `<div class="math-block">${body}</div>` : `<pre><code>${body}</code></pre>`;
      continue;
    }
    if (/^#{1,6} /.test(line)) {
      const n = line.match(/^#+/)[0].length;
      html += `<h${n}>${inline(line.slice(n + 1))}</h${n}>`; i++; continue;
    }
    if (/^\s*<(img|sub|p|div)/.test(line)) { html += line; i++; continue; }
    if (line.trim() === "") { i++; continue; }
    html += `<p>${inline(line)}</p>`; i++;
  }
  return html;
}

const page = (body, note) => `<!doctype html><meta charset="utf-8"><title>commit-waterfall preview</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<style>
  :root{--bg:#fff;--fg:#1f2328;--mut:#59636e;--bd:#d1d9e0;--cbg:#f6f8fa;--lnk:#0969da}
  @media (prefers-color-scheme:dark){
    :root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--bd:#3d444d;--cbg:#151b23;--lnk:#4493f8}}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
  .bar{position:sticky;top:0;background:var(--cbg);border-bottom:1px solid var(--bd);
       padding:8px 16px;font:12px ui-monospace,Menlo,monospace;color:var(--mut);
       display:flex;gap:16px} .bar b{color:var(--fg)} .bar a{color:var(--lnk);text-decoration:none}
  .wrap{max-width:1012px;margin:0 auto;padding:32px 16px 64px}
  .box{border:1px solid var(--bd);border-radius:6px;padding:32px 40px}
  img{max-width:100%;display:block;border-radius:6px}
  code{background:var(--cbg);border-radius:6px;padding:.2em .4em;
       font:85% ui-monospace,SFMono-Regular,Menlo,monospace}
  pre{background:var(--cbg);border-radius:6px;padding:16px;overflow:auto;
      font:13px/1.9 ui-monospace,Menlo,monospace;letter-spacing:1px}
  pre code{background:none;padding:0}
  sub{color:var(--mut);font-size:12px} p{margin:0 0 16px}
  .math-block{margin:16px 0;overflow-x:auto;text-align:center}
  .math-fallback{font:13px/1.9 ui-monospace,Menlo,monospace;color:var(--mut);
                 white-space:pre;text-align:left}
  .err{background:#3d1d1d;color:#ffb4b4;padding:16px;border-radius:6px;white-space:pre-wrap;
       font:13px ui-monospace,Menlo,monospace}
</style>
<div class="bar"><b>commit-waterfall</b><span>${note}</span><a href="/">reload</a></div>
<div class="wrap"><div class="box">${body}</div></div>
<script>
  // Render math the way GitHub does; fall back to source if KaTeX is unreachable.
  window.addEventListener("DOMContentLoaded", () => {
    const blocks = document.querySelectorAll(".math-block");
    if (typeof katex === "undefined") { blocks.forEach(el => el.classList.add("math-fallback")); return; }
    blocks.forEach((el) => {
      const src = el.textContent;
      try {
        // GitHub disallows some macros stock KaTeX permits (\operatorname among
        // them). Reject them here too, so the preview fails the same way.
        const banned = src.match(/\\(operatorname|includegraphics|def|newcommand|renewcommand)\b/);
        if (banned) throw new Error(`GitHub disallows the macro: ${banned[1]}`);
        katex.render(src, el, { displayMode: true, throwOnError: true });
      }
      catch (err) { el.classList.add("math-fallback"); el.textContent = `${src}\n\n^ ${err.message}`; }
    });
  });
</script>`;

createServer((req, res) => {
  let cfg;
  try { cfg = load(); } catch (err) {
    res.writeHead(500, { "content-type": "text/html" });
    return res.end(page(`<div class="err">${err.message}</div>`, "config error"));
  }

  const path = new URL(req.url, "http://x").pathname;
  if (path === `/${cfg.output.svg}` || path === "/console.svg") {
    if (!existsSync(cfg.output.svg)) { res.writeHead(404); return res.end("not built"); }
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
    return res.end(readFileSync(cfg.output.svg));
  }

  if (!existsSync(DATA)) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(page(`<div class="err">No survey data at ${DATA}.\n\nRun:  commit-waterfall scan</div>`, "no data"));
  }

  try {
    build(JSON.parse(readFileSync(DATA, "utf8")), cfg);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/html" });
    return res.end(page(`<div class="err">build failed\n\n${err.stack || err.message}</div>`, "build error"));
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(page(mdToHtml(readFileSync(cfg.output.readme, "utf8")),
    `${cfg.palette} · ${cfg.days} d · rebuilt on load`));
}).listen(PORT, () => console.log(`preview -> http://localhost:${PORT}`));
