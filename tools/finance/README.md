# Household finance dashboard

A private dashboard at `/finances`, served from this public site.

The page is inert until someone types the passphrase. Everything it shows arrives
as one AES-256-GCM blob (`public/finances/data.enc.json`) that is decrypted in the
browser and never leaves it. No account numbers, balances, payees or addresses
appear anywhere in this repo's source — they all travel inside the encrypted file.

## Rebuilding after new exports

1. Drop fresh exports into `finance-private/` (gitignored):
   - `transactions.csv` — Simplifi export
   - `mint.csv` — Mint export (historical; optional once it stops mattering)
2. Update balances, mortgage terms and house notes in `finance-private/config.json`.
3. Rebuild and re-encrypt:

   ```bash
   npm run finance          # prompts for the passphrase
   ```

4. Commit the encrypted output and push:

   ```bash
   git add public/finances/data.enc.json && git commit -m "Update finance data" && git push
   ```

   `data.enc.json` is a **tracked** file and should stay one. Do not add it to
   `.gitignore`: ignoring an already-tracked file does not untrack it, it only means
   the next `git add -A` quietly stages its deletion. What stops a weak or throwaway
   passphrase reaching the repo is the entropy check in `build-finance.mjs`, which
   refuses to encrypt at all rather than producing a publishable file.

Set `FINANCE_DEBUG=1` to also write `finance-private/payload.debug.json`, the
cleartext payload, for inspecting what the browser will receive. It is gitignored.

## When the passphrase does not work

```bash
npm run finance:check     # prompts; tests against the published blob in a second
```

It reports whether the passphrase opens the file, and if it only opens it after a
small alteration — a trailing space, a curly quote, a stripped `!` — it says which,
because that means the shell or a paste changed it on the way in rather than your
memory being wrong.

Two things make this failure common on this particular site:

- **zsh.** An unquoted or double-quoted `!` triggers history expansion, and `$word`
  expands inside double quotes. Typing the passphrase at the `npm run finance`
  prompt avoids both; it is taken literally.
- **Password managers.** The page is served from `github.io`, so a manager holding
  a GitHub credential for that domain will offer to fill the unlock field, and a
  masked input gives no sign that it did. Autofill is suppressed
  (`autocomplete="off"` plus the 1Password / LastPass / Bitwarden ignore
  attributes) and the field has a **show** toggle, so what is actually in it can be
  read before submitting. A failed attempt also reports the character count.

The build verifies its own output before writing: it decrypts the blob it just
produced with the same passphrase and refuses to write the file if that fails. So a
published payload is always openable by whatever the build actually received.

## The passphrase

The ciphertext is public, so the passphrase is the whole lock. Key derivation is
PBKDF2-SHA256 at 10,000,000 iterations — about a second per attempt — but PBKDF2
runs happily on a GPU, so the iteration count buys perhaps twenty bits and the
passphrase has to supply the rest.

Use five or six random words. `copper-lantern-vivid-otter-marsh` is easy to type,
easy to remember, and not guessable. The build script refuses anything under 20
characters or obviously predictable.

Changing the passphrase means re-running `npm run finance` with the new one; there
is no re-key step, the whole payload is simply re-encrypted.

## Where the numbers come from

| Source | Covers | Used for |
|---|---|---|
| Mint export | May 2012 → 27 Feb 2024 | Spending, income, categories, merchants |
| Simplifi export | 28 Feb 2024 → today | Everything, including balance reconstruction |
| `config.json` | current | Balances, mortgage, house projects, budgets |
| Hand-entered rows | as needed | Accounts with no feed — see below |
| Closing Disclosure | Jul 2026 | Mortgage terms, buydown, escrow — exact |
| Direct-deposit receipts | Aug 2026 | Gross, every deduction, employer contributions — exact |

The two exports overlap from Jan 2020, but Simplifi's rows over that window are a
partial backfill running 20–25% short of Mint's month by month. Rather than merge
and deduplicate, the pipeline cuts at the seam: each source owns the period it was
actually the live system.

## Accounts with no feed

Barclays stopped sharing with budgeting apps, so its balance is `manualUpdate: true`
in `config.json` with an `asOf` date, and enough of its recent activity is listed
under `manualTransactions` for the reconstruction to roll back correctly through the
house purchase. The dashboard reports how long ago a hand-updated account was last
checked rather than pretending the number is live.

This matters more than it sounds: Simplifi was still carrying a five-month-old
Barclays figure, which understated net worth by $66,262.

`onHold` on an account marks money that counts toward net worth but cannot be spent
yet, and the cash-runway figure is measured on what is actually reachable.

## Why balance history starts in 2024

Historical balances are recovered by rolling today's figures backward through the
ledger. That only works when every movement is recorded twice — once leaving an
account, once arriving. Simplifi does that and flags the pair as a transfer; Mint
recorded a credit-card payment only once.

Rolled back through the Mint years, the cards therefore reconstruct to six-figure
*positive* balances, which cannot happen. `trustBoundary()` in `analyze.mjs` finds
the earliest month from which every account stays plausible through to today, and
the net-worth charts start there. Spending and income do not depend on balances and
use the full fourteen years.

This is the general principle in the pipeline: where the data cannot support a
number, the dashboard says so on the front page rather than showing it anyway.

## The paycheck model

`paycheck.mjs` exists because the bank ledger only ever sees *net* pay. Measured on
transfers alone the household looks like it saves about 26% of take-home; counting
the ASRS pension, both 403(b)s, the HSA and the district's pension match — none of
which touch a visible account — it saves about 33% of gross.

The same module projects federal and Arizona liability against what is actually
being withheld. That projection is arithmetic over stated assumptions, not tax
advice: the standard deduction, the bracket table, the number of qualifying
children and the cost basis of the July 2026 Wealthfront sale are all guesses, and
every one of them is rendered on the Paycheck page with a dotted underline so it
can be checked or overridden in `config.json` → `taxAssumptions`.

## Files

```
tools/build-finance.mjs      orchestration: load → analyse → encrypt → write
tools/finance/parse.mjs      Simplifi reader, payee cleanup, flow classification
tools/finance/mint.mjs       Mint reader, taxonomy + account-name reconciliation
tools/finance/analyze.mjs    aggregates, recurring detection, reconstruction, amortisation
tools/finance/paycheck.mjs   gross-to-net model, true savings rate, withholding projection
tools/finance/crypt.mjs      PBKDF2 + AES-GCM envelope
src/pages/finances.astro     lock screen, app shell, design tokens
src/scripts/finance/vault.js decrypt + gunzip + ledger expansion
src/scripts/finance/app.js   the seven views
src/scripts/finance/charts.js hand-rolled SVG chart primitives
```

Nothing in `finance-private/` is ever committed.
