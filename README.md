# Kramata website

Single landing page + a blog for SEO. Pure static HTML/CSS — no build step.

## Run locally
Open `index.html` in a browser, or:
```bash
cd website && python3 -m http.server 8080   # http://localhost:8080
```

## Publish (this is its own public repo: `abhishekrai43/kramata-website`)
Run these in **Windows PowerShell** (Git for Windows handles the E: drive; git fails on
the WSL `/mnt/e` mount):
```powershell
cd E:\Kramata\website
git init
git add -A
git commit -m "Kramata website"
git branch -M main
git remote add origin https://github.com/abhishekrai43/kramata-website.git
git push -u origin main
```
Note: keep this separate from the private app-code repo. If you later `git init` the app
at `E:\Kramata`, add `/website` to that repo's `.gitignore`.

## Deploy to kramata.com (Cloudflare Pages)
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick
   `kramata-website`.
2. Framework preset: **None**. Build command: *(empty)*. Build output dir: **`/`** (root).
3. Deploy, then **Custom domains** → add `kramata.com` and `www.kramata.com` (Cloudflare
   wires DNS automatically since the domain is on Cloudflare).

## Still to add (placeholders)
- `assets/demo.gif` (messy→clean screen capture) and `assets/screenshot-grid.png`.
- App installer releases: upload the NSIS `.exe` (+ `latest.yml` for auto-update) to this
  repo's **Releases** — the site's Download button and electron-updater both point here.

## Why the website matters
1. **Conversion surface.** A non-technical analyst sent to a GitHub repo bounces. A clear page with
   a GIF + one download button converts.
2. **SEO surface.** The blog compounds over months and brings high-intent users for free.

## SEO content plan (the durable engine)
Target **escape-intent** searches — people actively looking for a better way. Write one focused,
genuinely useful article per keyword cluster. The first is published as a template:
`blog/clean-messy-csv-reproducibly.html`.

Cornerstone titles to write next (high intent):
- **Power Query alternative for non-technical users** — "power query alternative", "power query too complicated"
- **Remove duplicates and fix dates in a CSV without code** — "remove duplicates fix dates csv", "clean csv without excel formulas"
- **Automate recurring data cleaning (no scripts)** — "automate data cleaning", "reapply cleaning steps to new file"
- **How to standardize messy date formats in a spreadsheet** — "fix mixed date formats excel/csv"
- **Clean an Excel export with messy / merged headers** — "excel multi-row header to columns", "grouped header cleanup"
- **CSV vs Excel for recurring reports: cleaning that doesn't drift**

For each article: keep the same template (title/meta/canonical/OG + Article JSON-LD), 700–1000 words,
one clear download CTA, and internal links to the homepage + 1–2 sibling posts. Add each new URL to
`sitemap.xml` and link it from `blog/index.html`.

Distribution seed (not the engine, just the first trickle): GitHub Releases, a Reddit post in
r/dataisbeautiful / r/excel / r/analytics, Softpedia/AlternativeTo listings. Use these for first
reviews + feedback; rely on SEO for durable growth.
