/**
 * Tests for the parsing and model layer.
 *
 *   node --test
 *
 * Node's own runner, so this adds no dependency — the same reason the site has
 * no framework. js/csv.js and js/data.js are DOM-free and imported by both the
 * browser and scripts/validate-data.mjs, so they can be exercised directly.
 *
 * What is worth testing here is the stuff that bites when someone edits a CSV
 * in Excel and pushes: a delimiter that changed, a tick column that stopped
 * being recognised, a reference that no longer resolves. The rules live in
 * js/data.js precisely so the site and the validator cannot disagree about
 * them, and these lock that behaviour down.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCsv, isTicked, splitList, splitPairs, toNumber, normaliseKey, sniffDelimiter, stripBom,
} from '../js/csv.js';
import {
  buildModel, filterFacilities, facetCounts, groupForMap, productionShares,
} from '../js/data.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = (name) => fs.readFileSync(path.join(ROOT, 'data', name), 'utf8');

/* ------------------------------------------------------------------- csv */

test('a BOM does not become part of the first column name', () => {
  const { headers } = parseCsv('﻿"id","name"\n"a","b"\n');
  assert.equal(headers[0], 'id');
  assert.equal(stripBom('﻿x'), 'x');
});

test('the delimiter is sniffed, so a European Excel save still parses', () => {
  assert.equal(sniffDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(sniffDelimiter('a;b;c\n1;2;3'), ';');
  // A comma inside a quoted field must not win the vote.
  assert.equal(sniffDelimiter('"a,1";"b";"c"\n'), ';');
});

test('quotes carry delimiters and newlines through intact', () => {
  const { records } = parseCsv('"id","note"\n"x","one, two"\n"y","line\nbreak"\n');
  assert.equal(records[0].note, 'one, two');
  assert.equal(records[1].note, 'line\nbreak');
});

test('a doubled quote is an escaped quote', () => {
  const { records } = parseCsv('"id","note"\n"x","he said ""no"""\n');
  assert.equal(records[0].note, 'he said "no"');
});

test('every documented tick value counts, and blank does not', () => {
  for (const yes of ['x', 'X', '1', 'true', 'TRUE', 'yes', 'sì', ' x ']) {
    assert.equal(isTicked(yes), true, `${yes} should tick`);
  }
  for (const no of ['', '  ', null, undefined, '0', 'no', 'false']) {
    assert.equal(isTicked(no), false, `${JSON.stringify(no)} should not tick`);
  }
});

test('multi-value cells split on the pipe, and pairs on the double colon', () => {
  assert.deepEqual(splitList('a|b | c|'), ['a', 'b', 'c']);
  assert.deepEqual(splitList(''), []);
  assert.deepEqual(splitPairs('China::68|Chile::24'), [
    { label: 'China', value: '68' },
    { label: 'Chile', value: '24' },
  ]);
  // No separator means a label with no value, not a dropped entry.
  assert.deepEqual(splitPairs('China'), [{ label: 'China', value: '' }]);
});

test('numbers accept a decimal comma and refuse to become NaN', () => {
  assert.equal(toNumber('0,4'), 0.4);
  assert.equal(toNumber('12'), 12);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('n/a'), null);
  assert.equal(toNumber(null), null);
});

test('keys normalise across accents, case and punctuation', () => {
  assert.equal(normaliseKey('Light Rare Earths'), 'light-rare-earths');
  assert.equal(normaliseKey('light-rare-earths'), 'light-rare-earths');
  assert.equal(normaliseKey('Rönnskär'), 'ronnskar');
  // Letters NFD cannot decompose have to be transliterated by hand, or these
  // collapse to hyphens and stop matching a plainly typed spelling.
  assert.equal(normaliseKey('  Głogów  '), 'glogow');
  assert.equal(normaliseKey('Reyðarfjörður'), 'reydarfjordur');
  assert.equal(normaliseKey('Ærø'), 'aero');
  assert.equal(normaliseKey('Straße'), 'strasse');
});

/* ----------------------------------------------------------------- model */

/**
 * facilities.csv carries thirteen fixed columns before the material ticks, and
 * a missing one is an error by design. Writing them out in every fixture buried
 * the thing each test was actually about, so this emits them.
 */
const FIXED = [
  'id', 'name', 'company', 'city', 'country', 'stage', 'status',
  'note', 'source_url', 'confidence', 'last_checked', 'crma_project', 'crma_stage',
];

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * @param {string[]} materials  material tick column headings
 * @param {object[]} rows       any fixed column, plus a `ticks` array of headings
 */
function facilitiesCsv(materials, rows) {
  const header = [...FIXED, ...materials].map(q).join(',');
  const body = rows.map((r) => {
    const fixed = FIXED.map((c) => q(r[c] ?? ''));
    const ticks = materials.map((m) => q((r.ticks || []).includes(m) ? 'x' : ''));
    return [...fixed, ...ticks].join(',');
  });
  return [header, ...body].join('\n') + '\n';
}

const SITE = { company: 'Acme', status: 'operating', confidence: 'high' };

/** A tiny but complete dataset, so a rule can be broken one at a time. */
function fixture(overrides = {}) {
  return buildModel({
    elementsCsv: overrides.elementsCsv ?? '"id","name","strategic"\n"lithium","Lithium","x"\n"copper","Copper",""\n',
    citiesCsv: overrides.citiesCsv ?? '"city","country","lat","lon"\n"Kiruna","Sweden","67.85","20.22"\n"Lubin","Poland","51.40","16.20"\n',
    companiesCsv: overrides.companiesCsv ?? '"company","hq_country"\n"Acme","Sweden"\n',
    facilitiesCsv: overrides.facilitiesCsv ?? facilitiesCsv(['Lithium', 'Copper'], [
      { ...SITE, id: 'a', name: 'Mine A', city: 'Kiruna', country: 'Sweden', stage: 'mining', ticks: ['Lithium'] },
      { ...SITE, id: 'b', name: 'Plant B', city: 'Lubin', country: 'Poland', stage: 'smelting', ticks: ['Copper'] },
    ]),
    // Empty by default: a test that overrides elements.csv would otherwise trip
    // a production row referring to a material it just removed.
    productionCsv: overrides.productionCsv ?? '"element","stage","country","year","value","unit"\n',
  });
}

test('a clean fixture builds without errors', () => {
  const m = fixture();
  assert.deepEqual(m.errors, []);
  assert.equal(m.facilities.length, 2);
  assert.equal(m.stats.countries, 2);
});

test('a duplicate site id is an error, not a silent overwrite', () => {
  const m = fixture({
    facilitiesCsv: facilitiesCsv(['Lithium'], [
      { ...SITE, id: 'a', name: 'Mine A', city: 'Kiruna', country: 'Sweden', stage: 'mining', ticks: ['Lithium'] },
      { ...SITE, id: 'a', name: 'Mine A again', city: 'Kiruna', country: 'Sweden', stage: 'mining', ticks: ['Lithium'] },
    ]),
  });
  assert.equal(m.facilities.length, 1);
  assert.match(m.errors.map((e) => e.message).join(' '), /Duplicate site id/);
});

test('a site with no material ticked is an error', () => {
  const m = fixture({
    facilitiesCsv: facilitiesCsv(['Lithium'], [
      { ...SITE, id: 'a', name: 'Mine A', city: 'Kiruna', country: 'Sweden', stage: 'mining', ticks: [] },
    ]),
  });
  assert.equal(m.facilities.length, 0);
  assert.match(m.errors.map((e) => e.message).join(' '), /no materials ticked/);
});

test('an unknown stage is rejected rather than drawn in a default colour', () => {
  const m = fixture({
    facilitiesCsv: facilitiesCsv(['Lithium'], [
      { ...SITE, id: 'a', name: 'Mine A', city: 'Kiruna', country: 'Sweden', stage: 'levitating', ticks: ['Lithium'] },
    ]),
  });
  assert.equal(m.facilities.length, 0);
  assert.match(m.errors.map((e) => e.message).join(' '), /not a valid stage/);
});

test('a city with no coordinates row is an error, since the pin has nowhere to go', () => {
  const m = fixture({
    facilitiesCsv: facilitiesCsv(['Lithium'], [
      { ...SITE, id: 'a', name: 'Mine A', city: 'Atlantis', country: 'Sweden', stage: 'mining', ticks: ['Lithium'] },
    ]),
  });
  assert.equal(m.facilities.length, 0);
  assert.match(m.errors.map((e) => e.message).join(' '), /No coordinates/);
});

test('swapped latitude and longitude are caught', () => {
  const m = fixture({ citiesCsv: '"city","country","lat","lon"\n"Kiruna","Sweden","200","20.22"\n' });
  assert.match(m.errors.map((e) => e.message).join(' '), /out-of-range coordinates/);
});

test('an unlisted company warns but still draws the site', () => {
  const m = fixture({ companiesCsv: '"company","hq_country"\n"Someone Else","Sweden"\n' });
  assert.equal(m.errors.length, 0);
  assert.equal(m.facilities.length, 2);
  assert.match(m.warnings.map((w) => w.message).join(' '), /not listed in companies.csv/);
});

test('a material column that matches nothing in elements.csv is an error', () => {
  const m = fixture({
    facilitiesCsv: facilitiesCsv(['Unobtainium'], [
      { ...SITE, id: 'a', name: 'Mine A', city: 'Kiruna', country: 'Sweden', stage: 'mining', ticks: ['Unobtainium'] },
    ]),
  });
  assert.match(m.errors.map((e) => e.message).join(' '), /is not a known material/);
});

test('tick columns match loosely, so a readable heading still works', () => {
  const m = fixture({
    elementsCsv: '"id","name"\n"light-rare-earths","Light rare earth elements"\n',
    facilitiesCsv: facilitiesCsv(['Light Rare Earth Elements'], [
      { ...SITE, id: 'a', name: 'Mine A', city: 'Kiruna', country: 'Sweden', stage: 'mining',
        ticks: ['Light Rare Earth Elements'] },
    ]),
  });
  assert.deepEqual(m.errors, []);
  assert.deepEqual(m.facilities[0].elements, ['light-rare-earths']);
});

test('the country column is half the city key, so a wrong one fails the lookup', () => {
  // Not a soft disagreement: cities are keyed on name *and* country, so
  // "Kiruna, Norway" simply does not resolve and the row is dropped with an
  // error rather than being drawn in the wrong place.
  const m = fixture({
    facilitiesCsv: facilitiesCsv(['Lithium'], [
      { ...SITE, id: 'a', name: 'Mine A', city: 'Kiruna', country: 'Norway', stage: 'mining', ticks: ['Lithium'] },
    ]),
  });
  assert.equal(m.facilities.length, 0);
  assert.match(m.errors.map((e) => e.message).join(' '), /No coordinates for "Kiruna, Norway"/);
});

test('the city row is what sets a site country, not the facility column', () => {
  const m = fixture();
  assert.equal(m.facilities.find((f) => f.id === 'a').country, 'Sweden');
  assert.equal(m.facilities.find((f) => f.id === 'b').country, 'Poland');
});

/* ------------------------------------------------------------- filtering */

const allOf = (m) => ({
  elements: new Set(m.elements.map((e) => e.id)),
  stages: new Set(m.facilities.map((f) => f.stage)),
  countries: new Set(m.facilities.map((f) => f.country)),
  statuses: new Set(m.facilities.map((f) => f.status)),
  maturities: new Set(m.facilities.map((f) => f.company.maturity)),
  crma: new Set(['strategic', 'not-listed']),
  query: '',
});

test('facets are ANDed', () => {
  const m = fixture();
  const f = allOf(m);
  assert.equal(filterFacilities(m, { ...f, countries: new Set(['Sweden']) }).length, 1);
  assert.equal(
    filterFacilities(m, { ...f, countries: new Set(['Sweden']), stages: new Set(['smelting']) }).length,
    0
  );
});

test('an empty Set matches nothing — that is what Deselect all means', () => {
  const m = fixture();
  assert.equal(filterFacilities(m, { ...allOf(m), elements: new Set() }).length, 0);
});

test('a null facet is skipped entirely, which is how facetCounts relaxes one', () => {
  const m = fixture();
  assert.equal(filterFacilities(m, { ...allOf(m), elements: null }).length, 2);
});

test('the search covers name, operator, city, country and project', () => {
  const m = fixture();
  const f = allOf(m);
  for (const q of ['mine a', 'acme', 'kiruna', 'sweden']) {
    assert.ok(filterFacilities(m, { ...f, query: q }).length >= 1, `"${q}" should match`);
  }
  assert.equal(filterFacilities(m, { ...f, query: 'nothing here' }).length, 0);
});

test('a facet count ignores its own filter, so an option never reads zero for being unpicked', () => {
  const m = fixture();
  const counts = facetCounts(m, { ...allOf(m), countries: new Set(['Sweden']) });
  // Poland is deselected, but its count still reflects what picking it would give.
  assert.equal(counts.countries.get('Poland'), 1);
  assert.equal(counts.countries.get('Sweden'), 1);
  // The material counts, by contrast, do respect the country filter.
  assert.equal(counts.elements.get('lithium'), 1);
  assert.equal(counts.elements.get('copper'), undefined);
});

test('map markers group by city and stage together, never by city alone', () => {
  const m = fixture({
    facilitiesCsv: facilitiesCsv(['Lithium', 'Copper'], [
      { ...SITE, id: 'a', name: 'Smelter', city: 'Kiruna', country: 'Sweden', stage: 'smelting', ticks: ['Lithium'] },
      { ...SITE, id: 'b', name: 'Recycler', city: 'Kiruna', country: 'Sweden', stage: 'recycling', ticks: ['Copper'] },
      { ...SITE, id: 'c', name: 'Smelter 2', city: 'Kiruna', country: 'Sweden', stage: 'smelting', ticks: ['Lithium'] },
    ]),
  });
  const groups = groupForMap(m.facilities);
  assert.equal(groups.length, 2, 'two stages in one city is two markers');
  assert.equal(groups.find((g) => g.stage === 'smelting').facilities.length, 2);
});

/* ------------------------------------------------------------ production */

test('shares are not renormalised; the shortfall is returned as a remainder', () => {
  const m = fixture({
    productionCsv:
      '"element","country","year","value","unit"\n' +
      '"lithium","Australia","2023","52","share_pct"\n' +
      '"lithium","Chile","2023","24","share_pct"\n',
  });
  const el = m.elements.find((e) => e.id === 'lithium');
  const { rows, remainder } = productionShares(el, { year: 2023 });
  assert.equal(rows[0].share, 52, 'a 52% producer must not be promoted to 68%');
  assert.equal(remainder, 24);
});

test('shares over 100 warn rather than being silently rescaled', () => {
  const m = fixture({
    productionCsv:
      '"element","country","year","value","unit"\n' +
      '"lithium","A","2023","80","share_pct"\n' +
      '"lithium","B","2023","60","share_pct"\n',
  });
  assert.match(m.warnings.map((w) => w.message).join(' '), /over 100/);
});

/* ------------------------------------------------- the real data, briefly */

test('the shipped CSVs build with no errors', () => {
  const m = buildModel({
    elementsCsv: real('elements.csv'),
    citiesCsv: real('cities.csv'),
    companiesCsv: real('companies.csv'),
    facilitiesCsv: real('facilities.csv'),
    productionCsv: real('production.csv'),
  });
  assert.deepEqual(m.errors.map((e) => `${e.file}:${e.line} ${e.message}`), []);
  assert.ok(m.facilities.length > 100, 'the dataset should not have quietly emptied');
  assert.equal(m.elements.length, 34, 'the EU list is 34 materials');
  // Every site resolves to a real city and a real operator.
  for (const f of m.facilities) {
    assert.ok(f.city && Number.isFinite(f.city.lat), `${f.id} has no usable city`);
    assert.ok(f.company && f.company.name, `${f.id} has no operator`);
    assert.ok(f.elements.length > 0, `${f.id} has no materials`);
  }
});
