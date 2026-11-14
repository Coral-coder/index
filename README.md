# index

A stylized homepage that lists every **public** repository of this account that has **GitHub Pages** enabled.

## How it works

- `.github/workflows/pages.yml` runs on every push to `main`, once a day, and on demand.
- `scripts/build.mjs` (Node, no dependencies) asks the GitHub API for the owner's public repos, keeps the ones with Pages enabled (skipping archived repos and this one), and writes `data/repos.json` into `_site/` next to the static page.
- The page (`index.html` + `assets/`) reads that JSON and renders searchable, filterable cards with live-site and source links.

New Pages sites show up automatically on the next daily run (or trigger **Actions → Deploy to GitHub Pages → Run workflow**).

## One-time setup

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Merge to `main` (or run the workflow manually).

The site will be at `https://<owner>.github.io/index/`. To serve it at the root `https://<owner>.github.io/`, rename this repo to `<owner>.github.io`.

## Local preview

```sh
OWNER=<your-github-user> SELF_REPO=index node scripts/build.mjs
cd _site && python3 -m http.server
```

Opening `index.html` directly with `?owner=<user>` also works; it falls back to querying the GitHub API from the browser.
