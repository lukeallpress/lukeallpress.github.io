#!/usr/bin/env node
/**
 * Merge an export into the canonical ledger.
 *
 *   npm run finance:import -- finance-private/transactions.csv
 *   npm run finance:import -- ~/Downloads/"Simplifi - Transactions.csv"
 *   npm run finance:import                 # re-import everything configured
 *
 * Safe to run repeatedly. The same export merged twice changes nothing, a
 * longer export adds only the rows that are new, and any correction recorded
 * against a transaction id survives every future import.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';

import { loadTransactions } from './finance/parse.mjs';
import { loadMint } from './finance/mint.mjs';
import {
  dedupe, loadLedger, saveLedger, mergeIntoLedger, applyOverrides,
} from './finance/ledger.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'finance-private');
const LEDGER = path.join(SRC, 'ledger.jsonl');
const config = JSON.parse(readFileSync(path.join(SRC, 'config.json'), 'utf8'));

/** Formats are told apart by their header, not their filename. */
function detectFormat(file) {
  const head = readFileSync(file, 'utf8').slice(0, 400).split('\n')[0];
  if (/Transaction Type/.test(head) && /Account Name/.test(head)) return 'mint';
  if (/Payee/.test(head) && /Exclusion/.test(head)) return 'simplifi';
  throw new Error(`Unrecognised export format in ${path.basename(file)}\n  header: ${head}`);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const files = args.length ? args : [
  path.join(SRC, config.sources.mint),
  path.join(SRC, config.sources.simplifi),
].filter(existsSync);

if (!files.length) {
  console.error('\n  Nothing to import. Pass a CSV, or drop exports into finance-private/.\n');
  process.exit(1);
}

const store = loadLedger(LEDGER);
const before = store.size;
const importedAt = new Date().toISOString().slice(0, 10);
const seam = config.sources?.seam;

console.log(`\n  Ledger: ${before.toLocaleString()} transactions before import\n`);

let totalDropped = 0;
const allConflicts = [];

for (const file of files) {
  if (!existsSync(file)) { console.log(`  skipped (missing): ${file}`); continue; }
  const format = detectFormat(file);

  // Keep a copy of anything imported from outside the project, so the ledger
  // can always be rebuilt from scratch.
  const local = path.join(SRC, format === 'mint' ? config.sources.mint : config.sources.simplifi);
  if (path.resolve(file) !== path.resolve(local)) copyFileSync(file, local);

  let batch;
  if (format === 'mint') {
    batch = loadMint(local, config, seam);
  } else {
    // Simplifi's pre-seam rows are a partial backfill of the Mint years; Mint
    // owns that window. See tools/finance/mint.mjs.
    batch = loadTransactions(local, config).transactions
      .filter((t) => !seam || t.date > seam);
  }

  const { kept, dropped } = dedupe(batch);
  totalDropped += dropped.length;
  const stats = mergeIntoLedger(store, kept, format, importedAt);
  allConflicts.push(...stats.conflicting);

  console.log(`  ${path.basename(file)}  (${format})`);
  console.log(`     rows read        ${batch.length.toLocaleString()}`);
  console.log(`     duplicates found ${dropped.length.toLocaleString()}`);
  console.log(`     new to ledger    ${stats.added.toLocaleString()}`);
  console.log(`     already known    ${stats.alreadyKnown.toLocaleString()}`);
  console.log('');
}

// Hand-entered rows for accounts with no feed live in config, not in an export.
const manual = (config.manualTransactions ?? []).map((m) => ({
  ...m, rawPayee: m.payee, excluded: m.flow === 'transfer', source: 'manual',
}));
if (manual.length) {
  const { kept } = dedupe(manual);
  const stats = mergeIntoLedger(store, kept, 'manual', importedAt);
  console.log(`  config.json manualTransactions`);
  console.log(`     new to ledger    ${stats.added.toLocaleString()}`);
  console.log(`     already known    ${stats.alreadyKnown.toLocaleString()}\n`);
}

const overridesPath = path.join(SRC, 'overrides.json');
const overrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};
const applied = applyOverrides(store, overrides);

const written = saveLedger(LEDGER, store);

// A record of what this import did, so the dashboard can report the state of
// its own inputs rather than asserting the numbers are clean.
const sourceCounts = {};
for (const t of store.values()) sourceCounts[t.source] = (sourceCounts[t.source] ?? 0) + 1;
writeFileSync(path.join(SRC, 'ledger.stats.json'), JSON.stringify({
  importedAt,
  transactions: written,
  duplicatesSuppressed: totalDropped,
  conflicts: allConflicts.length,
  overridesApplied: applied,
  sources: sourceCounts,
  files: files.map((f) => path.basename(f)),
}, null, 2));

console.log('  ─────────────────────────────────────────────');
console.log(`  duplicates suppressed  ${totalDropped.toLocaleString()}`);
console.log(`  corrections applied    ${applied.toLocaleString()}`);
console.log(`  ledger now holds       ${written.toLocaleString()} transactions  (+${(written - before).toLocaleString()})`);

if (allConflicts.length) {
  console.log(`\n  ${allConflicts.length} transaction(s) categorised differently by two exports.`);
  console.log('  The ledger keeps what it already had. Override in overrides.json to change one:\n');
  for (const c of allConflicts.slice(0, 8)) {
    console.log(`    ${c.date}  ${c.payee.slice(0, 34).padEnd(34)}  kept "${c.was}" over "${c.now}"`);
    console.log(`      "${c.id}": { "category": "…" }`);
  }
  if (allConflicts.length > 8) console.log(`    …and ${allConflicts.length - 8} more`);
}

console.log('\n  Next: npm run finance   (rebuilds and re-encrypts the dashboard)\n');
