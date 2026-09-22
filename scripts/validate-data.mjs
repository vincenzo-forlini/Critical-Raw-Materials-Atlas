/**
 * Checks the CSV database and prints anything wrong with it.
 *
 *   node scripts/validate-data.mjs
 *
 * Exits 1 if there are errors, 0 if only warnings. Run it after editing the
 * CSVs, and let CI run it on every push.
 *
 * The rules live in js/data.js, which the site itself uses, so this cannot
 * drift out of step with what the map actually does.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel } from '../js/data.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const read = (name) => {
  const file = path.join(DATA, name);
  if (!fs.existsSync(file)) {
    console.error(`Missing data file: data/${name}`);
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8');
};

const model = buildModel({
  elementsCsv: read('elements.csv'),
  citiesCsv: read('cities.csv'),
  companiesCsv: read('companies.csv'),
  facilitiesCsv: read('facilities.csv'),
  productionCsv: read('production.csv'),
});

// ANSI colour, skipped when output is piped or NO_COLOR is set.
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (tty ? `[${code}m${s}[0m` : s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const green = (s) => c('32', s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);

function printGroup(title, items, colour) {
  if (items.length === 0) return;
  console.log(`\n${colour(bold(title))}`);
  const byFile = new Map();
  for (const i of items) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }
  for (const [file, list] of byFile) {
    console.log(`\n  ${bold(file)}`);
    for (const i of list) {
      const where = i.line ? `line ${i.line}` : '';
      console.log(`    ${colour('•')} ${dim(where.padEnd(9))} ${i.message}`);
      if (i.hint) console.log(`      ${dim(i.hint)}`);
    }
  }
}

console.log(bold('\nCritical Raw Materials Atlas — data check'));

const s = model.stats;
console.log(
  dim(
    `\n  ${s.facilities} sites · ${s.companies} companies · ${s.cities} cities with sites · ` +
      `${s.countries} countries · ${s.elementsWithSites}/${s.elements} materials represented`
  )
);

// Materials with no site anywhere are worth knowing about: the encyclopedia
// entry still works, but the map has nothing to show for them.
const orphanElements = model.elements.filter((e) => e.facility_count === 0);
if (orphanElements.length) {
  console.log(
    dim(`\n  No European sites recorded for: ${orphanElements.map((e) => e.name).join(', ')}`)
  );
}

// Confidence mix, since the whole dataset is a seed.
const byConfidence = { high: 0, medium: 0, low: 0 };
for (const f of model.facilities) byConfidence[f.confidence]++;
console.log(
  dim(
    `  Confidence: ${byConfidence.high} high · ${byConfidence.medium} medium · ${byConfidence.low} low`
  )
);
const unchecked = model.facilities.filter((f) => !f.last_checked).length;
if (unchecked) console.log(dim(`  ${unchecked} site(s) have never been source-verified.`));

// Designated projects and distressed operators, since both change how much
// weight a row deserves.
const strategic = model.facilities.filter((f) => f.crmaProject);
if (strategic.length) {
  const projects = new Set(strategic.map((f) => f.crmaProject));
  console.log(
    dim(`  ${projects.size} EU Strategic Project(s) across ${strategic.length} site(s).`)
  );
}

const distressed = model.companies.filter((c) => c.status && c.status !== 'active');
if (distressed.length) {
  console.log(yellow(`\n  ${distressed.length} operator(s) not trading normally:`));
  for (const c of distressed) {
    const sites = c.facilities.length;
    console.log(yellow(`    • ${c.name} — ${c.status} (${sites} site${sites === 1 ? '' : 's'})`));
  }
}

printGroup(`${model.errors.length} error(s)`, model.errors, red);
printGroup(`${model.warnings.length} warning(s)`, model.warnings, yellow);

if (model.errors.length === 0) {
  console.log(green(bold('\n✓ No errors.\n')));
  process.exit(0);
}

console.log(red(bold(`\n✗ ${model.errors.length} error(s) must be fixed.\n`)));
process.exit(1);
