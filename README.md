# Luke Allpress — personal site & CV

A classy, content-first personal site: selected work, writing, guidance documents,
and a printable CV. Built with [Astro](https://astro.build), hosted free on
**GitHub Pages**, edited locally and deployed by pushing to `main`.

---

## Everyday workflow

```bash
npm install        # first time only
npm run dev        # local preview at http://localhost:4321
```

Edit content, watch it update live, then commit and push. GitHub Actions builds
and deploys automatically.

```bash
npm run build      # production build into ./dist (optional local check)
npm run preview    # serve the built site locally
```

---

## Where the content lives

Everything you'll routinely edit is plain text:

| What | Where |
|------|-------|
| **Writing / essays** | `src/content/writing/*.md` — one Markdown file per post |
| **Projects / demos** | `src/content/projects/*.md` — one file per project |
| **Resume data** (experience, speaking, committees, education) | `src/data/profile.ts` |
| **Guidance documents** | `src/data/guidance.ts` |
| **Name, role, nav, social links** | `src/consts.ts` |
| **Colors, fonts, type scale** | `src/styles/global.css` (`:root` at the top) |

### Add a writing post
Create `src/content/writing/my-post.md`:

```markdown
---
title: My Post Title
summary: One-sentence standfirst shown in lists.
date: 2026-06-10
origin: Adapted from LinkedIn   # optional
tags: ['AI', 'Leadership']
draft: false                    # set true to hide it
---

Body in Markdown.
```

### Add a project
Create `src/content/projects/my-thing.md`:

```markdown
---
title: My Thing
summary: One line describing it.
order: 1            # lower = earlier in "Selected Work"
kind: Web app
year: 2026
tags: ['Web app']
demo: https://…     # optional — adds a "Live demo" link
source: https://…   # optional — adds a "Source" link
featured: true      # show on the home page
---

Longer description in Markdown.
```

### Search for `TODO: confirm`
A few fields were inferred from your LinkedIn (education degree, GPEMC/AZEMC names).
Search the repo for `TODO` to find and correct them.

---

## First-time deploy to GitHub Pages

1. **Create the repo.** On the `lukeallpress` GitHub account, make a new repo named
   **exactly** `lukeallpress.github.io` (this makes it a *user site* served at the
   clean root URL `https://lukeallpress.github.io`).

2. **Push this folder to it:**
   ```bash
   git init
   git add -A
   git commit -m "Initial site"
   git branch -M main
   git remote add origin https://github.com/lukeallpress/lukeallpress.github.io.git
   git push -u origin main
   ```

3. **Turn on Pages.** In the repo: **Settings → Pages → Build and deployment →
   Source = "GitHub Actions"**. The included workflow (`.github/workflows/deploy.yml`)
   does the rest on every push.

4. Wait for the green check in the **Actions** tab. Your site is live at
   `https://lukeallpress.github.io`.

> Prefer a project repo (e.g. `luke-site`) instead of a user site? See the comments
> in `astro.config.mjs` — you'll set `base: '/luke-site'` and adjust `site`.

---

## Custom domain (optional, later)

1. Buy a domain (≈$10–15/yr — the only non-free part, and entirely optional).
2. Add a file `public/CNAME` containing just your domain, e.g. `lukeallpress.com`.
3. At your domain registrar, point DNS at GitHub Pages
   ([instructions](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site)).
4. Update `site` in `astro.config.mjs` and `url` in `src/consts.ts` to the new domain.

No code structure changes are needed.
