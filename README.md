# index

A homepage that indexes every **GitHub Pages site** published from this account's public repos — pet projects, experiments, the lot.

## How it works

- `.github/workflows/pages.yml` runs on every push to `main`, once a day, and on demand.
- `scripts/build.mjs` asks the GitHub API which public repos have Pages enabled (skipping archived repos and this one), then visits each live page to grab its `<title>`, description and `og:image`, and takes a screenshot with Playwright.
- The result lands in `_site/data/repos.json` + `_site/shots/`, and the page (`index.html` + `assets/`) renders it as a searchable gallery of sites. A repo's `homepage` field, if set, is used as the page URL (handy for custom domains).

Public repos without Pages are listed in a collapsed "Other repos" section at the bottom.

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
