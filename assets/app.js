const $ = (s, el = document) => el.querySelector(s);

const LANG_COLORS = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", HTML: "#e34c26", CSS: "#663399", SCSS: "#c6538c",
  Python: "#3572A5", Rust: "#dea584", Go: "#00ADD8", Ruby: "#701516", Java: "#b07219", "C#": "#178600",
  "C++": "#f34b7d", C: "#555555", Shell: "#89e051", Vue: "#41b883", Svelte: "#ff3e00", Astro: "#ff5a03",
  Kotlin: "#A97BFF", Swift: "#F05138", Dart: "#00B4AB", PHP: "#4F5D95", Lua: "#000080", Elixir: "#6e4a7e",
  "Jupyter Notebook": "#DA5B0B", MDX: "#fcb32c", Markdown: "#083fa1", GDScript: "#355570", Zig: "#ec915c",
};
const colorFor = (lang) => {
  if (!lang) return "#8b8b9a";
  if (LANG_COLORS[lang]) return LANG_COLORS[lang];
  let h = 0; for (const c of lang) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 60%)`;
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso) {
  const s = (new Date(iso) - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return "just now";
}
const prettyName = (n) => n.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ---------- theme ---------- */
const root = document.documentElement;
try { const t = localStorage.getItem("theme"); if (t) root.dataset.theme = t; } catch {}
$("#theme-toggle").addEventListener("click", () => {
  const cur = root.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  root.dataset.theme = cur === "light" ? "dark" : "light";
  try { localStorage.setItem("theme", root.dataset.theme); } catch {}
});

/* ---------- data ---------- */
function guessOwner() {
  const p = new URLSearchParams(location.search).get("owner");
  if (p) return p;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  return m ? m[1] : null;
}

async function liveFallback(owner) {
  // Used only when data/repos.json is unavailable (e.g. local preview).
  const repos = [];
  for (let page = 1; page < 10; page++) {
    const r = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100&page=${page}&sort=pushed`);
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    const batch = await r.json(); repos.push(...batch);
    if (batch.length < 100) break;
  }
  const self = location.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  const host = `${owner.toLowerCase()}.github.io`;
  return {
    owner, generated_at: new Date().toISOString(), profile: null,
    repos: repos.filter((r) => !r.private && r.has_pages && !r.archived && r.name.toLowerCase() !== self).map((r) => ({
      name: r.name, description: r.description, repo: r.html_url, homepage: r.homepage,
      url: r.name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${r.name}/`,
      language: r.language, topics: r.topics || [], stars: r.stargazers_count, pushed_at: r.pushed_at,
    })),
  };
}

async function load() {
  try {
    const r = await fetch("data/repos.json", { cache: "no-cache" });
    if (r.ok) return await r.json();
  } catch {}
  const owner = guessOwner();
  if (!owner) throw new Error("No data/repos.json found. Add ?owner=<github-user> to preview locally.");
  return liveFallback(owner);
}

/* ---------- render ---------- */
const state = { q: "", lang: null, sort: "pushed", data: null };
const grid = $("#grid");
const tpl = $("#card-tpl");

function renderSkeletons() {
  grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join("");
}

function header(data) {
  const p = data.profile;
  const owner = p?.login || data.owner;
  document.title = `${p?.name || owner} · Projects`;
  $("#brand-name").textContent = owner;
  $("#gh-link").href = p?.url || `https://github.com/${owner}`;
  if (p?.avatar) { const a = $("#avatar"); a.src = p.avatar; a.hidden = false; }
  if (p?.bio) $("#bio").textContent = p.bio;
  const langs = new Set(data.repos.map((r) => r.language).filter(Boolean));
  $("#stat-sites").textContent = data.repos.length;
  $("#stat-langs").textContent = langs.size;
  const latest = data.repos.reduce((m, r) => (r.pushed_at > m ? r.pushed_at : m), "");
  $("#stat-updated").textContent = latest ? ago(latest) : "—";
  $("#generated").textContent = `Index generated ${ago(data.generated_at)}`;
}

function filtersUI(data) {
  const counts = {};
  for (const r of data.repos) { const l = r.language || "Other"; counts[l] = (counts[l] || 0) + 1; }
  const langs = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const el = $("#filters");
  el.innerHTML = "";
  if (langs.length < 2) return;
  const mk = (label, value, n) => {
    const b = document.createElement("button");
    b.innerHTML = value ? `<i style="background:${colorFor(value === "Other" ? null : value)}"></i>` : "";
    b.append(label);
    if (n != null) { const s = document.createElement("span"); s.textContent = n; b.append(s); }
    b.classList.toggle("active", state.lang === value);
    b.onclick = () => { state.lang = state.lang === value ? null : value; filtersUI(data); render(); };
    el.append(b);
  };
  mk("All", null, data.repos.length);
  for (const [l, n] of langs) mk(l, l, n);
}

function render() {
  const q = state.q.trim().toLowerCase();
  let list = state.data.repos.filter((r) => {
    if (state.lang && (r.language || "Other") !== state.lang) return false;
    if (!q) return true;
    return [r.name, r.description, r.language, ...(r.topics || [])].filter(Boolean).join(" ").toLowerCase().includes(q);
  });
  const sorters = {
    pushed: (a, b) => new Date(b.pushed_at) - new Date(a.pushed_at),
    stars: (a, b) => b.stars - a.stars || new Date(b.pushed_at) - new Date(a.pushed_at),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  list = list.slice().sort(sorters[state.sort]);

  grid.innerHTML = "";
  $("#empty").hidden = list.length > 0 || state.data.repos.length === 0;
  if (state.data.repos.length === 0) {
    grid.innerHTML = '<div class="error">No public repositories with GitHub Pages yet. Enable Pages on a repo and it will appear here on the next build.</div>';
    return;
  }
  list.forEach((r, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.style.setProperty("--i", i);
    const site = r.homepage && /^https?:\/\//.test(r.homepage) ? r.homepage : r.url;
    const thumb = $(".thumb", node);
    thumb.href = site;
    const img = $("img", thumb);
    img.alt = `${r.name} preview`;
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => { img.remove(); thumb.classList.add("fallback"); thumb.dataset.initial = r.name[0].toUpperCase(); };
    img.src = `https://opengraph.githubassets.com/${encodeURIComponent((r.pushed_at || "").slice(0, 10))}/${r.repo.split("/").slice(-2).join("/")}`;
    $(".name", node).textContent = prettyName(r.name);
    $(".name", node).title = r.name;
    $(".stars", node).textContent = r.stars ? `★ ${r.stars}` : "";
    const d = $(".desc", node);
    if (r.description) d.textContent = r.description; else { d.textContent = "No description"; d.classList.add("none"); }
    const tl = $(".topics", node);
    (r.topics || []).slice(0, 4).forEach((t) => { const li = document.createElement("li"); li.textContent = t; tl.append(li); });
    if (!tl.children.length) tl.remove();
    const lang = $(".lang", node);
    if (r.language) { $("i", lang).style.background = colorFor(r.language); $("b", lang).textContent = r.language; } else lang.remove();
    const t = $("time", node);
    t.dateTime = r.pushed_at; t.textContent = `Updated ${ago(r.pushed_at)}`;
    $(".src", node).href = r.repo;
    node.addEventListener("pointermove", (e) => {
      const b = node.getBoundingClientRect();
      node.style.setProperty("--mx", `${e.clientX - b.left}px`);
      node.style.setProperty("--my", `${e.clientY - b.top}px`);
    });
    grid.append(node);
  });
}

/* ---------- events ---------- */
const input = $("#q");
input.addEventListener("input", () => { state.q = input.value; render(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== input) { e.preventDefault(); input.focus(); }
  if (e.key === "Escape" && document.activeElement === input) { input.value = ""; state.q = ""; render(); input.blur(); }
});
document.querySelectorAll(".sort button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".sort button").forEach((x) => x.classList.toggle("active", x === b));
  state.sort = b.dataset.sort; render();
}));

renderSkeletons();
load().then((data) => { state.data = data; header(data); filtersUI(data); render(); })
  .catch((err) => { grid.innerHTML = `<div class="error">${err.message}</div>`; });
