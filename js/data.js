/**
 * Turns the four CSVs into an indexed model, and reports everything wrong with
 * them on the way.
 *
 * Pure and DOM-free on purpose: the browser imports this to draw the map, and
 * scripts/validate-data.mjs imports the same functions under Node. The rules
 * live in one place and cannot drift between the site and the checker.
 */

import { parseCsv, isTicked, splitList, splitPairs, toNumber, toBool, normaliseKey } from './csv.js';

export const STAGE_VALUES = [
  'mining', 'processing', 'refining', 'smelting', 'recycling', 'recovery', 'substitution',
];
export const STATUS_VALUES = ['operating', 'construction', 'planned', 'care-and-maintenance', 'closed'];
export const CONFIDENCE_VALUES = ['high', 'medium', 'low'];

/**
 * How established a company is. "Incumbent" is the standard term for the
 * opposite of a startup, and is the default: an unfilled cell means an ordinary
 * established operator rather than missing data.
 *
 * Spin-offs are counted as startups. Nearly every university spin-out in this
 * sector is also a startup, and forcing a choice between the two labels would
 * lose more than it gained — the spin-off origin is recorded in the company's
 * description instead, where it can be read but does not fragment the filter.
 */
export const MATURITY_VALUES = ['incumbent', 'scale-up', 'startup'];

/**
 * Whether a site is part of a Strategic Project designated under the Critical
 * Raw Materials Act. These are the most authoritative rows in the dataset: the
 * project name, promoter, country, material and value-chain stage all come from
 * the Commission's own annex rather than from compilation.
 */
export const CRMA_VALUES = ['strategic', 'not-listed'];

/**
 * Corporate standing of the operator.
 *
 * Deliberately a property of the company, not of the site. A plant can run
 * normally while its owner is in court — Larco's Larymna works and Northvolt's
 * recycling arm are both cases where the site status and the company status say
 * different things, and collapsing them into one field would lose whichever is
 * the more interesting half.
 *
 * `active` is the default, so a blank cell means an ordinary company rather
 * than missing data.
 */
export const COMPANY_STATUS_VALUES = [
  'active', 'insolvency', 'liquidation', 'acquired', 'dissolved',
];

/** The Act's own four value-chain categories, kept verbatim. They are coarser
 *  than this project's stages, so both are recorded rather than one inferred. */
export const CRMA_STAGES = ['extraction', 'processing', 'recycling', 'substitution'];

/** Columns in facilities.csv that are NOT material tick columns. */
export const FACILITY_FIXED_COLUMNS = [
  'id', 'name', 'company', 'city', 'country', 'stage', 'status',
  'note', 'source_url', 'confidence', 'last_checked',
  'crma_project', 'crma_stage',
];

/* ------------------------------------------------------------------ errors */

function makeReporter() {
  const issues = [];
  const add = (severity) => (file, line, message, hint) => {
    issues.push({ severity, file, line: line ?? null, message, hint: hint ?? null });
  };
  return { issues, error: add('error'), warn: add('warning') };
}

const cityKeyOf = (name, country) => `${normaliseKey(name)}|${normaliseKey(country)}`;

/* ---------------------------------------------------------------- elements */

function buildElements(csvText, report) {
  const { records } = parseCsv(csvText);
  const elements = [];
  const byId = new Map();
  const byKey = new Map(); // normalised id AND name, for matching tick columns

  for (const r of records) {
    const id = normaliseKey(r.id || r.name);
    if (!id) {
      report.error('elements.csv', r._line, 'Row has neither an id nor a name.');
      continue;
    }
    if (byId.has(id)) {
      report.error('elements.csv', r._line, `Duplicate material id "${id}".`,
        `Already defined on line ${byId.get(id)._line}.`);
      continue;
    }

    const el = {
      id,
      name: r.name || id,
      symbol: r.symbol || '',
      strategic: toBool(r.strategic),
      category: r.category || 'other',
      summary: r.summary || '',
      uses: splitList(r.uses),
      // EU-level indicators stay here; who produces what lives in production.csv.
      indicators: {
        eu_import_reliance_pct: toNumber(r.eu_import_reliance_pct),
        eol_recycling_input_rate_pct: toNumber(r.eol_recycling_input_rate_pct),
        substitution_index: toNumber(r.substitution_index),
      },
      production: [],
      eu_note: r.eu_note || '',
      sources: splitPairs(r.sources)
        .map((p) => ({ label: p.label, url: p.value }))
        .filter((s) => s.url),
      _line: r._line,
    };

    elements.push(el);
    byId.set(id, el);
    byKey.set(id, el);
    byKey.set(normaliseKey(el.name), el);
    if (el.symbol) byKey.set(normaliseKey(el.symbol), el);
  }

  return { elements, byId, byKey };
}

/* -------------------------------------------------------------- production */

/**
 * Long-format production data: one row per material, stage, country and year.
 *
 * This shape drives both charts. Filter to a single year and you have the pie;
 * follow one country across years and you have the line. Adding a year of data
 * means appending rows, never restructuring the file.
 */
function buildProduction(csvText, elementIndex, report) {
  if (!csvText) return [];
  const { records } = parseCsv(csvText);
  const rows = [];

  for (const r of records) {
    const el = elementIndex.byKey.get(normaliseKey(r.element));
    if (!el) {
      report.error('production.csv', r._line, `"${r.element}" is not a known material.`,
        'It must match an id or name in elements.csv.');
      continue;
    }
    const year = toNumber(r.year);
    const value = toNumber(r.value);
    if (year === null) {
      report.error('production.csv', r._line, `Row for ${el.name} / ${r.country} has no usable year.`);
      continue;
    }
    if (value === null) {
      report.error('production.csv', r._line,
        `Row for ${el.name} / ${r.country} (${r.year}) has no usable value.`);
      continue;
    }
    if (!r.country) {
      report.error('production.csv', r._line, `Row for ${el.name} (${r.year}) has no country.`);
      continue;
    }

    const unit = r.unit || 'share_pct';
    if (unit === 'share_pct' && (value < 0 || value > 100)) {
      report.warn('production.csv', r._line,
        `${el.name} / ${r.country} ${r.year}: ${value} is not a valid percentage.`);
    }

    rows.push({
      elementId: el.id,
      stage: r.stage || 'extraction',
      country: r.country,
      year,
      value,
      unit,
      source_url: r.source_url || '',
      note: r.note || '',
      _line: r._line,
    });
  }

  // A year whose shares add up to far more or less than 100 is usually a typo.
  const groups = new Map();
  for (const row of rows) {
    if (row.unit !== 'share_pct') continue;
    const k = `${row.elementId}|${row.stage}|${row.year}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  for (const [k, list] of groups) {
    const total = list.reduce((s, r) => s + r.value, 0);
    if (total > 105) {
      const [elId, stage, year] = k.split('|');
      report.warn('production.csv', list[0]._line,
        `${elId} (${stage}, ${year}) shares total ${Math.round(total)}%, which is over 100.`);
    }
  }

  return rows;
}

/* ------------------------------------------------------- production charts */

/** Distinct stages that have production data for a material. */
export function productionStages(element) {
  return [...new Set((element.production || []).map((r) => r.stage))];
}

/** Distinct years, ascending. */
export function productionYears(element, stage) {
  const rows = (element.production || []).filter((r) => !stage || r.stage === stage);
  return [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
}

/**
 * Country breakdown for one stage and year.
 *
 * Percentages are taken at face value and NOT renormalised. The file usually
 * lists only the top few producers, so rescaling them to sum to 100 would
 * quietly promote a 52% producer to 58%. Any shortfall is returned as
 * `remainder`, which the chart shows as an explicit "rest of world" slice.
 *
 * Tonnages, having no such problem, are converted to shares of their own total.
 *
 * @returns {{rows: {country, value, share, unit}[], remainder: number, unit: string}}
 */
export function productionShares(element, { stage, year } = {}) {
  let rows = element.production || [];
  if (stage) rows = rows.filter((r) => r.stage === stage);
  if (year) rows = rows.filter((r) => r.year === year);
  if (rows.length === 0) return { rows: [], remainder: 0, unit: '' };

  const unit = rows[0].unit;
  const total = rows.reduce((s, r) => s + r.value, 0);
  const isShare = unit === 'share_pct';

  const out = rows
    .map((r) => ({
      country: r.country,
      value: r.value,
      unit: r.unit,
      share: isShare ? r.value : total > 0 ? (r.value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const covered = out.reduce((s, r) => s + r.share, 0);
  return { rows: out, remainder: Math.max(0, 100 - covered), unit };
}

/**
 * One series per country across years, for a line chart.
 * @returns {{country: string, points: {year: number, value: number}[]}[]}
 */
export function productionSeries(element, { stage } = {}) {
  let rows = element.production || [];
  if (stage) rows = rows.filter((r) => r.stage === stage);

  const byCountry = new Map();
  for (const r of rows) {
    if (!byCountry.has(r.country)) byCountry.set(r.country, []);
    byCountry.get(r.country).push({ year: r.year, value: r.value });
  }

  return [...byCountry.entries()]
    .map(([country, points]) => ({
      country,
      points: points.sort((a, b) => a.year - b.year),
    }))
    .sort((a, b) => {
      const last = (s) => s.points[s.points.length - 1]?.value ?? 0;
      return last(b) - last(a);
    });
}

/* ------------------------------------------------------------------ cities */

function buildCities(csvText, report) {
  const { records } = parseCsv(csvText);
  const cities = [];
  const byKey = new Map();

  for (const r of records) {
    const name = r.city || r.name;
    const country = r.country;
    if (!name || !country) {
      report.error('cities.csv', r._line, 'A city row needs both a city and a country.');
      continue;
    }

    const lat = toNumber(r.lat);
    const lon = toNumber(r.lon);
    if (lat === null || lon === null) {
      report.error('cities.csv', r._line, `${name} has no usable coordinates.`,
        `Got lat="${r.lat}" lon="${r.lon}".`);
      continue;
    }
    // Catches swapped lat/lon, which otherwise silently drops a pin in the sea.
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      report.error('cities.csv', r._line, `${name} has out-of-range coordinates (${lat}, ${lon}).`);
      continue;
    }
    if (lat < 27 || lat > 82 || lon < -35 || lon > 65) {
      report.warn('cities.csv', r._line,
        `${name} (${lat}, ${lon}) falls outside the European map area and will not be visible.`);
    }

    const key = cityKeyOf(name, country);
    if (byKey.has(key)) {
      report.error('cities.csv', r._line, `Duplicate city "${name}, ${country}".`,
        `Already defined on line ${byKey.get(key)._line}.`);
      continue;
    }

    const city = {
      key,
      name,
      country,
      country_code: (r.country_code || '').toUpperCase(),
      lat,
      lon,
      is_capital: toBool(r.is_capital),
      _line: r._line,
    };
    cities.push(city);
    byKey.set(key, city);
  }

  return { cities, byKey };
}

/* --------------------------------------------------------------- companies */

function buildCompanies(csvText, report) {
  const { records } = parseCsv(csvText);
  const companies = [];
  const byKey = new Map();

  for (const r of records) {
    const name = r.company || r.name;
    if (!name) {
      report.error('companies.csv', r._line, 'Row has no company name.');
      continue;
    }
    const key = normaliseKey(name);
    if (byKey.has(key)) {
      report.error('companies.csv', r._line, `Duplicate company "${name}".`,
        `Already defined on line ${byKey.get(key)._line}.`);
      continue;
    }
    if (r.website && !/^https?:\/\//i.test(r.website)) {
      report.warn('companies.csv', r._line, `${name} has a website that is not a URL: "${r.website}".`);
    }

    const maturity = normaliseKey(r.maturity) || 'incumbent';
    if (!MATURITY_VALUES.includes(maturity)) {
      report.error('companies.csv', r._line, `"${r.maturity}" is not a valid maturity for ${name}.`,
        `Use one of: ${MATURITY_VALUES.join(', ')}. Leave it blank for an established operator.`);
      continue;
    }

    const status = normaliseKey(r.status) || 'active';
    if (!COMPANY_STATUS_VALUES.includes(status)) {
      report.error('companies.csv', r._line, `"${r.status}" is not a valid company status for ${name}.`,
        `Use one of: ${COMPANY_STATUS_VALUES.join(', ')}. Leave it blank for an ordinary trading company.`);
      continue;
    }
    // A bare "insolvency" with no date or detail is close to useless, and it is
    // a serious thing to assert about a real company.
    if (status !== 'active' && !r.status_note) {
      report.warn('companies.csv', r._line,
        `${name} is flagged "${status}" with no status_note.`,
        'Say what happened and when, so a reader can judge how stale the flag is.');
    }

    const company = {
      key,
      name,
      hq_country: r.hq_country || '',
      website: r.website || '',
      type: r.type || '',
      maturity,
      status,
      status_note: r.status_note || '',
      // Filename under assets/logos/. Blank is fine: the panel draws a monogram.
      logo: r.logo || '',
      news_query: r.news_query || '',
      facilities: [],
      _line: r._line,
    };
    companies.push(company);
    byKey.set(key, company);
  }

  return { companies, byKey };
}

/* -------------------------------------------------------------- facilities */

function buildFacilities(csvText, { elementIndex, cityIndex, companyIndex }, report) {
  const { headers, records } = parseCsv(csvText);

  // Every header that is not a fixed column is treated as a material tick column.
  const fixed = new Set(FACILITY_FIXED_COLUMNS);
  const tickColumns = [];
  for (const h of headers) {
    if (!h || fixed.has(h)) continue;
    const el = elementIndex.byKey.get(normaliseKey(h));
    if (!el) {
      report.error('facilities.csv', 1, `Column "${h}" is not a known material.`,
        'Add it to elements.csv, or fix the spelling. Column headings are matched loosely, so "Light Rare Earths" and "light-rare-earths" both work.');
      continue;
    }
    tickColumns.push({ header: h, elementId: el.id });
  }

  for (const c of FACILITY_FIXED_COLUMNS) {
    if (!headers.includes(c) && c !== 'note' && c !== 'country') {
      report.error('facilities.csv', 1, `Missing required column "${c}".`);
    }
  }

  const facilities = [];
  const byId = new Map();

  for (const r of records) {
    const line = r._line;
    const id = normaliseKey(r.id);
    if (!id) {
      report.error('facilities.csv', line, `Row has no id (name: "${r.name || '?'}").`);
      continue;
    }
    if (byId.has(id)) {
      report.error('facilities.csv', line, `Duplicate site id "${id}".`,
        `Already used on line ${byId.get(id)._line}.`);
      continue;
    }

    const stage = normaliseKey(r.stage);
    if (!STAGE_VALUES.includes(stage)) {
      report.error('facilities.csv', line, `"${r.stage}" is not a valid stage for ${r.name || id}.`,
        `Use one of: ${STAGE_VALUES.join(', ')}.`);
      continue;
    }

    const status = normaliseKey(r.status) || 'operating';
    if (!STATUS_VALUES.includes(status)) {
      report.error('facilities.csv', line, `"${r.status}" is not a valid status for ${r.name || id}.`,
        `Use one of: ${STATUS_VALUES.join(', ')}.`);
      continue;
    }

    const confidence = normaliseKey(r.confidence) || 'low';
    if (!CONFIDENCE_VALUES.includes(confidence)) {
      report.error('facilities.csv', line, `"${r.confidence}" is not a valid confidence for ${r.name || id}.`,
        `Use one of: ${CONFIDENCE_VALUES.join(', ')}.`);
      continue;
    }

    const city = cityIndex.byKey.get(cityKeyOf(r.city, r.country));
    if (!city) {
      report.error('facilities.csv', line, `No coordinates for "${r.city}, ${r.country}".`,
        'Add a row to cities.csv with its latitude and longitude.');
      continue;
    }

    let company = companyIndex.byKey.get(normaliseKey(r.company));
    if (!company && r.company) {
      // Not fatal: draw the site, but say the company is undescribed.
      report.warn('facilities.csv', line, `Company "${r.company}" is not listed in companies.csv.`,
        'The site still appears; add the company to give it a website and news.');
      company = {
        key: normaliseKey(r.company),
        name: r.company,
        hq_country: '',
        website: '',
        type: '',
        maturity: 'incumbent',
        status: 'active',
        status_note: '',
        logo: '',
        news_query: '',
        facilities: [],
        _synthesised: true,
      };
      companyIndex.byKey.set(company.key, company);
      companyIndex.companies.push(company);
    }
    if (!r.company) {
      report.error('facilities.csv', line, `${r.name || id} has no company.`);
      continue;
    }

    const elementIds = tickColumns.filter((t) => isTicked(r[t.header])).map((t) => t.elementId);
    if (elementIds.length === 0) {
      report.error('facilities.csv', line, `${r.name || id} has no materials ticked.`,
        'Tick at least one material column with an x.');
      continue;
    }

    if (!r.source_url) {
      report.warn('facilities.csv', line, `${r.name || id} has no source_url.`);
    } else if (!/^https?:\/\//i.test(r.source_url)) {
      report.warn('facilities.csv', line, `${r.name || id} has a source that is not a URL: "${r.source_url}".`);
    }

    // Strategic Project designation under the CRM Act. The promoter stays the
    // headline entity — the project name is a label on top of it, not a
    // replacement for it.
    const crmaProject = (r.crma_project || '').trim();
    // Several designated projects are integrated across two categories, so this
    // is a multi-value field: "extraction|processing".
    const crmaStage = splitList(r.crma_stage).map(normaliseKey);
    const badStage = crmaStage.find((s) => !CRMA_STAGES.includes(s));
    if (badStage) {
      report.error('facilities.csv', line,
        `"${badStage}" is not a CRM Act value-chain category for ${r.name || id}.`,
        `Use one or more of: ${CRMA_STAGES.join(', ')}, separated by "|".`);
      continue;
    }
    if (crmaStage.length && !crmaProject) {
      report.warn('facilities.csv', line,
        `${r.name || id} has a crma_stage but no crma_project name.`);
    }

    const facility = {
      id,
      name: r.name || id,
      company,
      companyKey: company.key,
      crmaProject,
      crmaStage,
      crma: crmaProject ? 'strategic' : 'not-listed',
      city,
      cityKey: city.key,
      country: city.country, // the city is authoritative
      stage,
      status,
      note: r.note || '',
      source_url: r.source_url || '',
      confidence,
      last_checked: r.last_checked || '',
      elements: [...new Set(elementIds)],
      _line: line,
    };

    facilities.push(facility);
    byId.set(id, facility);
    company.facilities.push(facility);
  }

  return { facilities, byId, tickColumns };
}

/* ------------------------------------------------------------------- model */

/**
 * @param {{elementsCsv: string, citiesCsv: string, companiesCsv: string, facilitiesCsv: string}} sources
 */
export function buildModel(sources) {
  const report = makeReporter();

  const elementIndex = buildElements(sources.elementsCsv, report);
  const production = buildProduction(sources.productionCsv, elementIndex, report);
  for (const row of production) elementIndex.byId.get(row.elementId)?.production.push(row);

  const cityIndex = buildCities(sources.citiesCsv, report);
  const companyIndex = buildCompanies(sources.companiesCsv, report);
  const facilityIndex = buildFacilities(
    sources.facilitiesCsv,
    { elementIndex, cityIndex, companyIndex },
    report
  );

  // Cross-references that only make sense once everything is loaded.
  const usedElements = new Set(facilityIndex.facilities.flatMap((f) => f.elements));
  const usedCities = new Set(facilityIndex.facilities.map((f) => f.cityKey));

  for (const city of cityIndex.cities) {
    if (!usedCities.has(city.key) && !city.is_capital) {
      report.warn('cities.csv', city._line,
        `${city.name} has no sites and is not flagged as a capital.`,
        'Harmless, but it is dead weight in the file.');
    }
  }

  const elements = elementIndex.elements.map((el) => ({
    ...el,
    facility_count: facilityIndex.facilities.filter((f) => f.elements.includes(el.id)).length,
  }));

  return {
    elements,
    elementById: new Map(elements.map((e) => [e.id, e])),
    cities: cityIndex.cities,
    cityByKey: cityIndex.byKey,
    companies: companyIndex.companies.filter((c) => c.facilities.length > 0),
    companyByKey: companyIndex.byKey,
    facilities: facilityIndex.facilities,
    facilityById: facilityIndex.byId,
    issues: report.issues,
    errors: report.issues.filter((i) => i.severity === 'error'),
    warnings: report.issues.filter((i) => i.severity === 'warning'),
    stats: {
      facilities: facilityIndex.facilities.length,
      companies: companyIndex.companies.filter((c) => c.facilities.length > 0).length,
      cities: usedCities.size,
      elements: elements.length,
      elementsWithSites: usedElements.size,
      countries: new Set(facilityIndex.facilities.map((f) => f.country)).size,
    },
  };
}

/* --------------------------------------------------------------- filtering */

/**
 * Facilities matching the current selection. All criteria are ANDed.
 *
 * A facet given as a Set is applied literally, so an empty Set matches nothing —
 * that is what "Deselect all" means. Passing `null` for a facet skips it, which
 * is how facetCounts relaxes one dimension at a time.
 */
export function filterFacilities(model, filters) {
  const { elements, stages, countries, statuses, maturities, crma, query } = filters;
  const elementSet = elements instanceof Set ? elements : null;
  const stageSet = stages instanceof Set ? stages : null;
  const countrySet = countries instanceof Set ? countries : null;
  const statusSet = statuses instanceof Set ? statuses : null;
  const maturitySet = maturities instanceof Set ? maturities : null;
  const crmaSet = crma instanceof Set ? crma : null;
  const q = (query || '').trim().toLowerCase();

  return model.facilities.filter((f) => {
    if (stageSet && !stageSet.has(f.stage)) return false;
    if (countrySet && !countrySet.has(f.country)) return false;
    if (statusSet && !statusSet.has(f.status)) return false;
    if (maturitySet && !maturitySet.has(f.company.maturity)) return false;
    if (crmaSet && !crmaSet.has(f.crma)) return false;
    if (elementSet && !f.elements.some((e) => elementSet.has(e))) return false;
    if (q) {
      const hay = `${f.name} ${f.company.name} ${f.city.name} ${f.country} ${f.crmaProject}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** One marker per city and stage — see the note at the top of js/map.js. */
export function groupForMap(facilities) {
  const groups = new Map();
  for (const f of facilities) {
    const key = `${f.cityKey}::${f.stage}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, city: f.city, stage: f.stage, facilities: [] };
      groups.set(key, g);
    }
    g.facilities.push(f);
  }
  return [...groups.values()];
}

/** Facilities grouped by operator, for the Companies tab. */
export function groupByCompany(facilities) {
  const map = new Map();
  for (const f of facilities) {
    let g = map.get(f.companyKey);
    if (!g) {
      g = { company: f.company, facilities: [], countries: new Set(), stages: new Set(), elements: new Set() };
      map.set(f.companyKey, g);
    }
    g.facilities.push(f);
    g.countries.add(f.country);
    g.stages.add(f.stage);
    for (const e of f.elements) g.elements.add(e);
  }
  return [...map.values()].sort(
    (a, b) => b.facilities.length - a.facilities.length || a.company.name.localeCompare(b.company.name)
  );
}

/** How many facilities each value of a facet would match. Drives the counts
 *  beside every checkbox. Computed with that facet's own filter removed, so a
 *  count never reads zero just because the option is currently unselected. */
export function facetCounts(model, filters) {
  const count = (facet, valuesOf) => {
    const relaxed = { ...filters, [facet]: null };
    const rows = filterFacilities(model, relaxed);
    const out = new Map();
    for (const f of rows) {
      for (const v of valuesOf(f)) out.set(v, (out.get(v) || 0) + 1);
    }
    return out;
  };

  return {
    elements: count('elements', (f) => f.elements),
    stages: count('stages', (f) => [f.stage]),
    countries: count('countries', (f) => [f.country]),
    statuses: count('statuses', (f) => [f.status]),
    maturities: count('maturities', (f) => [f.company.maturity]),
    crma: count('crma', (f) => [f.crma]),
  };
}

export function countriesByFacilityCount(facilities) {
  const out = {};
  for (const f of facilities) out[f.country] = (out[f.country] || 0) + 1;
  return out;
}
