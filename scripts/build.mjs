// Builds the static site into _site/: an index of every GitHub Pages site
// published from OWNER's public, non-archived repositories.
import { mkdir, cp, writeFile, rm } from "node:fs/promises";

const OWNER = process.env.OWNER;
const SELF = (process.env.SELF_REPO || "").toLowerCase();
const TOKEN = process.env.GITHUB_TOKEN;
if (!OWNER) throw new Error("OWNER env var is required");

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "pages-index-builder",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
}

async function listRepos() {
  // /users/{owner}/repos works for both users and orgs' public repos.
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/users/${OWNER}/repos?per_page=100&page=${page}&type=owner&sort=pushed`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function pagesUrl(repo) {
  try {
    const info = await gh(`/repos/${repo.full_name}/pages`);
    if (info?.html_url) return info.html_url;
  } catch { /* token may lack access; fall back below */ }
  const host = `${OWNER.toLowerCase()}.github.io`;
  return repo.name.toLowerCase() === host
    ? `https://${host}/`
    : `https://${host}/${repo.name}/`;
}

const allRepos = (await listRepos()).filter(
  (r) => !r.private && !r.archived && r.name.toLowerCase() !== SELF,
);
const repos = allRepos.filter((r) => r.has_pages);
// Public repos without a Pages site, listed in a collapsed section at the bottom.
const others = allRepos.filter((r) => !r.has_pages).map((r) => ({
  name: r.name,
  description: r.description,
  repo: r.html_url,
  language: r.language,
  fork: r.fork,
  pushed_at: r.pushed_at,
})).sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));

// Pull the page's own <title>, description and og:image so each entry is
// about the site itself rather than the repository behind it.
async function pageMeta(url) {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "pages-index-builder" } });
    if (!res.ok) return { live: false };
    const html = (await res.text()).slice(0, 200_000);
    const decode = (t) => t?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim() || null;
    const meta = (key) => {
      const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, "i");
      const tag = html.match(re)?.[0];
      return decode(tag?.match(/content=["']([^"']*)["']/i)?.[1]);
    };
    const title = meta("og:title") || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);
    let image = meta("og:image") || meta("twitter:image");
    if (image) { try { image = new URL(image, res.url).href; } catch { image = null; } }
    return { live: true, title, description: meta("description") || meta("og:description"), image };
  } catch {
    return { live: false };
  }
}

const items = await Promise.all(
  repos.map(async (r) => {
    const url = r.homepage && /^https?:\/\//.test(r.homepage) ? r.homepage : await pagesUrl(r);
    const m = await pageMeta(url);
    return {
      name: r.name,
      title: m.title || null,
      description: m.description || r.description || null,
      url,
      image: m.image || null,
      live: m.live,
      repo: r.html_url,
      language: r.language,
      pushed_at: r.pushed_at,
      created_at: r.created_at,
    };
  }),
);
items.sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));

let profile = null;
try {
  const u = await gh(`/users/${OWNER}`);
  profile = { login: u.login, name: u.name, bio: u.bio, avatar: u.avatar_url, url: u.html_url, blog: u.blog };
} catch { /* optional */ }

const payload = { owner: OWNER, generated_at: new Date().toISOString(), profile, repos: items, others };

await rm("_site", { recursive: true, force: true });
await mkdir("_site/data", { recursive: true });
await cp("index.html", "_site/index.html");
await cp("assets", "_site/assets", { recursive: true });
await writeFile("_site/.nojekyll", "");
await writeFile("_site/data/repos.json", JSON.stringify(payload, null, 2));
console.log(`Indexed ${items.length} Pages sites for ${OWNER}:`);
for (const i of items) console.log(`  ${i.live ? "•" : "x"} ${i.name} → ${i.url}${i.title ? ` (${i.title})` : ""}`);

// Screenshot every live page (Playwright is installed in CI; skipped if absent).
try {
  const { chromium } = await import("playwright");
  // Software WebGL keeps canvas-heavy pages from stalling the capture on CI.
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  await mkdir("_site/shots", { recursive: true });
  const shoot = async (i) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(i.url, { waitUntil: "load", timeout: 30000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);
      // Games keep the main thread busy forever; stop their loops so a frame can be captured.
      await Promise.race([
        page.evaluate(() => {
          window.requestAnimationFrame = () => 0;
          for (let id = 1; id < 10000; id++) clearInterval(id);
        }).catch(() => {}),
        new Promise((r) => setTimeout(r, 45000)),
      ]);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `_site/shots/${i.name}.jpg`, type: "jpeg", quality: 72, timeout: 45000 });
      i.shot = `shots/${i.name}.jpg`;
    } catch (e) {
      console.warn(`  screenshot failed for ${i.name}: ${e.message.split("\n")[0]}`);
    } finally {
      await page.close().catch(() => {});
    }
  };
  // A few at a time, so one slow page doesn't hold up the rest.
  const queue = items.filter((x) => x.live);
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await shoot(queue.shift()); }));
  await browser.close();
  await writeFile("_site/data/repos.json", JSON.stringify(payload, null, 2));
  console.log(`Captured ${items.filter((x) => x.shot).length} screenshots.`);
} catch (e) {
  console.warn(`Skipping screenshots: ${e.message}`);
}
