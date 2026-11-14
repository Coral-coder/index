// Builds the static site into _site/ and writes data/repos.json with every
// public, non-archived repo owned by OWNER that has GitHub Pages enabled.
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

const repos = (await listRepos()).filter(
  (r) => !r.private && r.has_pages && !r.archived && r.name.toLowerCase() !== SELF,
);

const items = await Promise.all(
  repos.map(async (r) => ({
    name: r.name,
    description: r.description,
    url: await pagesUrl(r),
    repo: r.html_url,
    homepage: r.homepage || null,
    language: r.language,
    topics: r.topics || [],
    stars: r.stargazers_count,
    forks: r.forks_count,
    fork: r.fork,
    pushed_at: r.pushed_at,
    created_at: r.created_at,
  })),
);
items.sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));

let profile = null;
try {
  const u = await gh(`/users/${OWNER}`);
  profile = { login: u.login, name: u.name, bio: u.bio, avatar: u.avatar_url, url: u.html_url, blog: u.blog };
} catch { /* optional */ }

const payload = { owner: OWNER, generated_at: new Date().toISOString(), profile, repos: items };

await rm("_site", { recursive: true, force: true });
await mkdir("_site/data", { recursive: true });
await cp("index.html", "_site/index.html");
await cp("assets", "_site/assets", { recursive: true });
await writeFile("_site/.nojekyll", "");
await writeFile("_site/data/repos.json", JSON.stringify(payload, null, 2));
console.log(`Indexed ${items.length} Pages sites for ${OWNER}:`);
for (const i of items) console.log(`  • ${i.name} → ${i.url}`);
