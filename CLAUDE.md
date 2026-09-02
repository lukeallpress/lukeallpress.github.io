# CLAUDE.md

Guidance for Claude Code (and any AI or human collaborator) working in this repository.
This file is committed to the repo, so it travels with the project to any machine or account.

---

## What this is

The personal CV / portfolio site for **Luke Allpress** — an education-technology and AI
leader in Arizona. The goal is a **classy, credible, editorial** public profile: selected
work and demos, short introspective essays, guidance documents, speaking history, and a
printable CV.

- **Live:** https://lukeallpress.github.io
- **Repo:** https://github.com/lukeallpress/lukeallpress.github.io (public **user** site)
- **Owner GitHub:** `lukeallpress` (personal account — *not* the AFUHSD org)

## Everyday workflow

```bash
npm install      # first time only
npm run dev      # local preview → http://localhost:4321
npm run build    # production build into ./dist (also the CI build)
npm run preview  # serve the built ./dist locally
```

Edit locally → commit → **push to `main`** → GitHub Actions builds and deploys automatically
(~40s). Luke's normal expectation is **"make the change and publish"** — commit and push
each change unless he says otherwise.

## Deploy

- `.github/workflows/deploy.yml` uses `withastro/action` + `actions/deploy-pages` on every
  push to `main`. Pages **Source = "GitHub Actions"** (`build_type=workflow`).
- Harmless quirk: a legacy `pages-build-deployment` (Jekyll) check may show one ❌ in the
  Actions tab. Ignore it — the green **"Deploy to GitHub Pages"** run is the real one.
- Custom domain later: add `public/CNAME`, point DNS, update `site` in `astro.config.mjs`
  and `url` in `src/consts.ts`. See `README.md`.

## Tech stack

- **Astro 5** static site (content layer via `src/content.config.ts`, glob loader).
- `@astrojs/sitemap`. Fonts self-hosted through `@fontsource-variable/{fraunces,inter}`.
- **No client-side JS framework.** TypeScript strict. Zero-JS by default.

---

## Where content lives (edit these)

| What | File(s) |
|------|---------|
| Writing / essays | `src/content/writing/*.md` — one file per post |
| Projects / demos | `src/content/projects/*.md` — one file per project |
| Résumé data (about, experience, affiliations, speaking, committees, skills, awards, education, certs) | `src/data/profile.ts` |
| Guidance documents & toolkits | `src/data/guidance.ts` |
| Site name, tagline, nav, social links, email | `src/consts.ts` |
| Colors, fonts, type scale, design tokens | `src/styles/global.css` (`:root` at top) |
| Layout & components | `src/layouts/Base.astro`, `src/components/*.astro` |
| Pages | `src/pages/` — `index.astro` (home), `cv.astro`, `writing/`, `projects/[...slug].astro`, `404.astro` |

### Add a writing post
Create `src/content/writing/<slug>.md`:
```markdown
---
title: My Title
summary: One-sentence standfirst shown in lists and atop the essay.
date: 2026-06-20
origin: Adapted from a LinkedIn post   # optional
tags: ['AI', 'Leadership']
draft: false                            # true hides it
---
Body in Markdown.
```

### Add a project
Create `src/content/projects/<slug>.md`:
```markdown
---
title: My Project
summary: One line describing it.
order: 3               # lower = earlier in Selected Work (Innovation Hub is 0 = flagship)
kind: Web app         # short category label
year: 2026
status: Live          # optional badge: "Live" | "Prototype" | "Demo" | "Internal"
tags: ['Web app']
demo: https://…       # optional — renders a demo button/link
source: https://…     # optional — renders a source link
featured: true        # show on the home Selected Work grid
draft: false
---
Longer description in Markdown.
```

### Résumé data — `src/data/profile.ts`
Exports (all typed): `ABOUT`, `BIO_SHORT`, `EXPERIENCE`, `AFFILIATIONS`, `SPEAKING`,
`COMMITTEES`, `SKILLS`, `AWARDS`, `EDUCATION`, `CERTS`. The CV page and the home page's
Speaking/Community/Toolkit sections render straight from these arrays.
- `SPEAKING` is ordered **most-recent-first by hand**; `year` is a display string
  (`'Jul 2026'`, `'2025'`, etc.), so ordering is array order, not sorted.
- Some `SpeakingItem`/`AffiliationItem`/`CommitteeItem` entries carry a `verify?: boolean`
  and a `// VERIFY` comment — see **Open items** below. The flag is *not* rendered; it's a
  reminder that a fact still needs Luke's confirmation.

### Content model notes
- Home Selected Work = projects with `featured: true && !draft`, sorted ascending by `order`.
- `status` badge styling: **"Live"** = gold accent wash; anything else = muted outline.
- Home "Latest writing" shows the 3 newest non-draft posts; `/writing` lists all.

---

## Design system

Editorial-serif, warm and high-trust — *not* a startup landing page, *not* stuffy-academic.

- **Type:** Fraunces Variable (serif display/headings) + Inter Variable (sans body).
- **Palette** (tokens in `src/styles/global.css` `:root`): warm paper `#FAF7F0`, ink-navy
  text `#20242B`, one muted-gold accent `#8C6A37`, hairline `#E7DECE`.
- Generous whitespace, ~68ch measure for prose, fluid `clamp()` type scale, subtle hover
  motion, theme-consistent. Essays render like magazine pieces (italic serif standfirst).
- Favicon is an inline "LA" monogram SVG in `public/favicon.svg`.

## House style & conventions

- **Write `K12`, never `K-12`.** (House rule.)
- **Essays use only Luke's own words** — never reproduce other people's LinkedIn posts or
  copyrighted text. His reposts/comments on others' content stay off the site.
- **Accuracy over impressiveness.** Don't invent facts, dates, titles, or metrics. Anything
  unconfirmed gets a `// VERIFY` comment and defensible wording until Luke confirms.
- **Voice:** candid, practical, values-forward, human. The essay *"Thank You, Working Moms"*
  is intentionally feminist — preserve that voice; don't sand it down.
- **Commits:** end messages with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Keep private/working files out of the public repo** (already in `.gitignore`):
  `chatgpt output.md`, `gemini output.md`, `.claude/settings.local.json`.

---

## About the subject (for accurate content)

- **Luke Allpress**, CETL — **Director of Innovative Solutions**, Agua Fria Union High School
  District (AFUHSD), Phoenix/Avondale AZ. Tagline: *"Making complicated things simple."*
- **AzTEA Board President-Elect** (Arizona's ISTE affiliate & CoSN state chapter; elected
  Jun 2026; previously Board Secretary 2024–2026, board member since 2023).
- **Arizona AI Alliance** core team member; contributing author on the 2026 Arizona AI
  Guidance. **BRIDGE Consulting** partner & co-founder (AI advisory for education systems and
  nonprofits — confirmed with Luke). **CoSN Driving K12 Innovation Advisory Board** member.
- Leads the **AzTEA TLE (Trusted Learning Environment) cohort**; founded the **AI Learning
  Network** community of practice.
- **Site & District DEI Lead** (2020–2024). Former math/science teacher, interventionist,
  Teach For America corps member.
- **Education:** M.Ed., Arizona State University (2015); B.S. Bioengineering, with Honors,
  University of Washington (2013).
- **Builder:** SQL Server / Synergy SIS, Python, Dash/Plotly, Google Apps Script, Git,
  AI-assisted development, MCP/agentic tooling, self-hosted LLMs.

### Selected Work order (flagship first)
`0` **Innovation Hub** (Live — flagship; district web app used daily by hundreds of AFUHSD
staff: Intervention, Attendance, Coaches Corner [athletic — athlete grades/eligibility],
Teacher Dash; demo at innovation.aguafria.org/demo-mode) · `1` AZ AI Guidance Companion
(Live) · `2` Agentic Builders Commons (Live — the only *fully* functional one besides the
Hub) · `3` AZ AI Implementation Consultant (Prototype) · `4` CoSN Screentime Mindfulness
Coach (Prototype) · `5` District MCP Server · `6` Partnership Tracker · `7` Self-Hosted LLMs
· `8` Open Enrollment Automation · `9` Euchre Bot.

---

## Private finance dashboard (`/finances`)

An unlisted, passphrase-gated household finance dashboard lives at `/finances`. It is
**not** part of the site: no nav link, no sitemap entry, `noindex`, and no Base layout.

- **Nothing private is ever committed.** `finance-private/` (raw exports, balances,
  mortgage terms, cleartext payload) is gitignored. The only thing published is
  `public/finances/data.enc.json` — one AES-256-GCM blob, decrypted in the browser.
- **No identifying strings in source.** Addresses, account names and figures all
  travel inside the encrypted payload. Keep it that way when editing the views.
- Rebuild with `npm run finance` (prompts for the passphrase), then commit the blob.
- The tax/withholding projection is **arithmetic over stated assumptions, not advice**.
  Every assumption is rendered on the page with a dotted underline and lives in
  `config.json` → `taxAssumptions`. Keep it that way.
- Full documentation: `tools/finance/README.md`.

---

## Open items / awaiting Luke

Search the repo for `VERIFY` and `TODO`. Currently outstanding:
- **CoSN 2025** session — exact title (placeholder: "Cybersecurity for K12 School Districts").
- **Arizona CIO/CTO Summit** — confirm exact event name and years (placeholders 2024 for the
  AI-implementation talk, 2023 for the RTI talk).
- **Demo/source links** for Partnership Tracker and Euchre Bot (frontmatter commented out).
- **Public links** for guidance documents in `src/data/guidance.ts`.
- **LinkedIn profile** updates were prepared but not yet applied (Featured, Website, Projects,
  role updates). Dates still needed for the TLE Cohort and Agentic Builders Committee entries.
- Optional: professional headshot; possible AzTEA Fall Conference talks (unconfirmed).
- **Finance dashboard:** the $60,000 MidFirst wire of 2026-09-01 has no matching account
  on the balance sheet; the Simplifi payroll feed has gaps from mid-2025; HSA Checking and
  Barclays Savings have stale connections. All three are surfaced on the dashboard itself.
- **Finance dashboard — needs Luke:** the realised gain on the July 2026 Wealthfront sale
  (estimated at 48% of proceeds from the contribution ledger; the real figure is in Wealthfront
  under Documents → Tax documents → Realized gains and losses, and on the 1099-B in February);
  payroll still shows the old address on both direct-deposit receipts.
- **Barclays Savings has no feed** — they stopped sharing with budgeting apps. Its balance and
  recent rows are typed into `config.json` by hand (`manualUpdate`, `manualTransactions`) and
  go stale; refresh them when rebuilding. Simplifi was carrying a five-month-old figure that
  understated net worth by $66,262.
- Confirmed with Luke: 3 qualifying children; the $60,000 MidFirst wire of 2026-09-01 repaid a
  family loan taken toward the down payment, modelled as a liability for July–August; the second
  $80,000 of 2026-09-01 went to Barclays Savings and is still on hold.

## Notable history

Content was seeded from Luke's LinkedIn (his own posts only) plus briefs he supplied, then
fact-checked directly with him; anything that couldn't be confirmed was removed rather than
softened. When in doubt, ask Luke before adding a claim. Repo `agentic-builders-committee`
is **private** — do not surface it publicly (the public sibling is `agentic-builders-commons`).
