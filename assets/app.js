const $ = (s, el = document) => el.querySelector(s);

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso) {
  const s = (new Date(iso) - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return "just now";
}
const prettyName = (n) => n.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const shortUrl = (u) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
const hash = (str) => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
// Placeholder art for pages without a screenshot, in the lava-lamp palette.
const LAMP = [
  "linear-gradient(160deg, #0a3cff, #2f7bff 45%, #9dff4a)",
  "linear-gradient(200deg, #061a5c, #1f5fe0 55%, #b8ff7a)",
  "radial-gradient(circle at 50% 110%, #e2ffb3, #9dff4a 30%, #2f7bff 75%, #0a2a8a)",
  "linear-gradient(140deg, #9dff4a, #4fd06a 40%, #1f5fe0)",
];

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
  // Only used when data/repos.json is missing (e.g. a local preview).
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
    others: repos.filter((r) => !r.private && !r.has_pages && !r.archived && r.name.toLowerCase() !== self)
      .map((r) => ({ name: r.name, description: r.description, repo: r.html_url, language: r.language, fork: r.fork, pushed_at: r.pushed_at })),
    repos: repos.filter((r) => !r.private && r.has_pages && !r.archived && r.name.toLowerCase() !== self).map((r) => ({
      name: r.name, description: r.description, repo: r.html_url, live: true,
      url: r.homepage?.startsWith("http") ? r.homepage : r.name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${r.name}/`,
      pushed_at: r.pushed_at,
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
const state = { q: "", sort: "pushed", data: null };
const grid = $("#grid");
const tpl = $("#card-tpl");
const titleOf = (p) => p.title || prettyName(p.name);

function header(data) {
  const p = data.profile;
  const owner = p?.login || data.owner;
  document.title = `${p?.name || owner} · Pet Projects`;
  $("#brand-name").textContent = owner;
  $("#gh-link").href = p?.url || `https://github.com/${owner}`;
  if (p?.avatar) { const a = $("#avatar"); a.src = p.avatar; a.hidden = false; }
  $("#stat-sites").textContent = data.repos.length;
  const latest = data.repos.reduce((m, r) => (r.pushed_at > m ? r.pushed_at : m), "");
  $("#stat-updated").textContent = latest ? ago(latest) : "—";
  $("#generated").textContent = `Last refreshed ${ago(data.generated_at)}`;
}

function placeholder(thumb, page) {
  thumb.classList.add("fallback");
  thumb.style.setProperty("--ph", LAMP[hash(page.name) % LAMP.length]);
  $(".shot", thumb).dataset.initial = titleOf(page)[0].toUpperCase();
}

function renderOthers(q) {
  const others = state.data.others || [];
  const box = $("#others");
  box.hidden = others.length === 0;
  if (!others.length) return;
  const list = others.filter((r) => !q || [r.name, r.description, r.language].filter(Boolean).join(" ").toLowerCase().includes(q))
    .sort(state.sort === "name" ? (a, b) => a.name.localeCompare(b.name) : (a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
  $("#others-count").textContent = q ? `${list.length} / ${others.length}` : others.length;
  if (q && list.length) box.open = true;
  const ul = $("#others-list");
  ul.innerHTML = "";
  for (const r of list) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = r.repo; a.target = "_blank"; a.rel = "noopener";
    const name = document.createElement("strong"); name.textContent = r.name;
    const desc = document.createElement("span"); desc.className = "o-desc"; desc.textContent = r.description || "";
    const meta = document.createElement("span"); meta.className = "o-meta";
    meta.textContent = [r.fork ? "fork" : null, r.language, ago(r.pushed_at)].filter(Boolean).join(" · ");
    a.append(name, desc, meta);
    li.append(a); ul.append(li);
  }
  if (!list.length) ul.innerHTML = '<li class="o-empty">No matches here either.</li>';
}

function render() {
  const q = state.q.trim().toLowerCase();
  const pages = state.data.repos;
  let list = pages.filter((p) => !q || [p.title, p.name, p.description, p.url].filter(Boolean).join(" ").toLowerCase().includes(q));
  const sorters = {
    pushed: (a, b) => new Date(b.pushed_at) - new Date(a.pushed_at),
    name: (a, b) => titleOf(a).localeCompare(titleOf(b)),
  };
  list = list.slice().sort(sorters[state.sort]);
  renderOthers(q);

  grid.innerHTML = "";
  $("#empty").hidden = list.length > 0 || pages.length === 0;
  if (pages.length === 0) {
    grid.innerHTML = '<div class="error">No pages yet. Turn on GitHub Pages for a repo and it will show up on the next refresh.</div>';
    return;
  }
  list.forEach((p, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.style.setProperty("--i", i);
    const thumb = $(".thumb", node);
    thumb.href = p.url;
    $(".addr", thumb).textContent = shortUrl(p.url);
    const img = $("img", thumb);
    const src = p.shot || p.image;
    if (src) {
      img.alt = `Screenshot of ${titleOf(p)}`;
      img.onload = () => img.classList.add("loaded");
      img.onerror = () => { img.remove(); placeholder(thumb, p); };
      img.src = src;
    } else { img.remove(); placeholder(thumb, p); }

    const a = $(".name a", node);
    a.href = p.url; a.textContent = titleOf(p);
    const u = $(".url", node);
    u.href = p.url; u.textContent = shortUrl(p.url);
    const d = $(".desc", node);
    if (p.description) d.textContent = p.description; else d.remove();
    const t = $("time", node);
    t.dateTime = p.pushed_at; t.textContent = `Poked ${ago(p.pushed_at)}`;
    if (p.live === false) $(".down", node).hidden = false;
    $(".src", node).href = p.repo;
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

grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join("");
load().then((data) => { state.data = data; header(data); render(); })
  .catch((err) => { grid.innerHTML = `<div class="error">${err.message}</div>`; });
