// Production scanner: builds the survey from the GitHub API.
//
// /users/{u}/events/public caps near 300 events and 90 days, which cannot fill
// a longer window, so this walks per-repository commit lists instead. When
// emitters are anonymised, private repositories can be included safely - names
// never leave the runner.
export async function scanGitHub(cfg, token) {
  if (!token) throw new Error("a token is required for source \"github\" (set GH_TOKEN)");
  if (!cfg.user) throw new Error('source "github" requires "user" in config');

  const sinceMs = Date.now() - cfg.days * 86400_000;
  const sinceISO = new Date(sinceMs).toISOString();
  let calls = 0;

  async function gh(path) {
    const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "commit-waterfall",
        "x-github-api-version": "2022-11-28",
      },
    });
    calls++;
    if (res.status === 409 || res.status === 404) return { data: [], next: null };
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
      throw new Error(`rate limited; resets ${reset ? new Date(reset).toISOString() : "unknown"}`);
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${url}`);
    const m = (res.headers.get("link") || "").match(/<([^>]+)>;\s*rel="next"/);
    return { data: await res.json(), next: m ? m[1] : null };
  }

  async function paged(path, cap = 10) {
    const out = [];
    let next = path, pages = 0;
    while (next && pages++ < cap) {
      const { data, next: n } = await gh(next);
      if (!Array.isArray(data)) break;
      out.push(...data);
      next = n;
    }
    return out;
  }

  const all = await paged(`/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=pushed`);
  const candidates = all.filter((r) => {
    if (cfg.exclude.includes(r.name) || cfg.exclude.includes(r.full_name)) return false;
    if (!cfg.includePrivate && r.private) return false;
    return r.pushed_at && Date.parse(r.pushed_at) >= sinceMs;   // cannot contribute otherwise
  });

  const repos = [];
  for (const r of candidates) {
    let commits;
    try {
      commits = await paged(`/repos/${r.full_name}/commits?author=${encodeURIComponent(cfg.user)}&since=${sinceISO}&per_page=100`);
    } catch (err) {
      console.warn(`  skipped ${r.full_name}: ${err.message}`);
      continue;
    }
    const events = commits
      .map((c) => Math.floor(Date.parse(c.commit?.author?.date || c.commit?.committer?.date || 0) / 1000))
      .filter((t) => Number.isFinite(t) && t > 0)
      .sort((a, b) => a - b)
      .map((t) => ({ t, a: 0, d: 0 }));
    if (events.length < cfg.minCommits) continue;

    repos.push({
      name: r.full_name, head: commits[0]?.sha || "", private: !!r.private, events,
      total: events.length, first: events[0].t, last: events[events.length - 1].t,
    });
  }

  repos.sort((a, b) => b.total - a.total);
  if (cfg.signal.metric === "lines") {
    console.warn('  note: signal.metric "lines" needs per-commit stats, which the API only returns one commit at a time; falling back to commit counts');
  }
  console.log(`  ${all.length} repos visible, ${repos.length} emitters, ${calls} API calls`);

  return {
    generated: Math.floor(Date.now() / 1000), days: cfg.days, repos,
    loc: { added: 0, removed: 0, since: 0, baseline: "unavailable via API" },
  };
}
