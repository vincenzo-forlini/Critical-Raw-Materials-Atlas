/**
 * The contextual right-hand panel: city, company, or material.
 *
 * Every panel is a pure function from model + id to an HTML string. Click
 * handling is delegated in app.js via data- attributes, so nothing here needs
 * to hold a reference to the map or the filter state.
 */

import { STAGE_LABELS, STAGES, stageIcon } from './icons.js';
import { productionShares, productionSeries, productionStages, productionYears } from './data.js';
import { donutChart, lineChart, meter } from './charts.js';
import {
  esc, stageChip, statusChip, elementChips, confidenceBadge, sourceLink, empty, plural, rcard, companyLink,
  maturityChip, crmaChip, companyStatusChip, companyLogo,
} from './ui.js';

/* ------------------------------------------------------------------- parts */

function facilityCard(f, elementById) {
  return rcard({
    act: 'focus-facility',
    id: f.id,
    label: `Show ${f.name} on the map`,
    body: `
    <div class="rcard__top">
      <span class="rcard__name">${esc(f.name)}</span>
      ${statusChip(f.status)}
    </div>
    <div class="rcard__where">
      ${companyLink(f.company)}
      &middot; ${esc(f.city.name)}, ${esc(f.country)}
    </div>
    <div class="rcard__meta">
      ${companyStatusChip(f.company)}
      ${crmaChip(f, { compact: true })}
      ${stageChip(f.stage)}
      ${elementChips(f.elements, elementById, { max: 3 })}
    </div>`,
  });
}

function facilityDetail(f, elementById) {
  return `<article class="fdetail">
    <div class="fdetail__head">
      <h4>${esc(f.name)}</h4>
      ${statusChip(f.status)}
    </div>
    <div class="fdetail__co">
      ${companyLogo(f.company, { small: true })}
      ${companyLink(f.company)}
      ${companyStatusChip(f.company)}
    </div>
    ${f.crmaProject ? `<div class="sub">${crmaChip(f)}</div>` : ''}
    <dl class="kv">
      <dt>Location</dt><dd>${esc(f.city.name)}, ${esc(f.country)}</dd>
      <dt>Stage</dt><dd>${STAGE_LABELS[f.stage]}</dd>
      ${f.crmaProject ? `<dt>Project</dt><dd>${esc(f.crmaProject)}</dd>` : ''}
      ${f.crmaStage.length ? `<dt>CRM Act stage</dt><dd>${esc(f.crmaStage.join(', '))}</dd>` : ''}
      <dt>Materials</dt><dd>${f.elements.map((id) =>
        `<button type="button" class="link link--btn" data-act="open-element" data-id="${esc(id)}">${esc(elementById.get(id)?.name || id)}</button>`
      ).join(', ')}</dd>
    </dl>
    ${f.note ? `<p class="fdetail__note">${esc(f.note)}</p>` : ''}
    <div class="fdetail__foot">
      ${confidenceBadge(f.confidence, f.last_checked)}
      ${sourceLink(f.source_url)}
    </div>
  </article>`;
}

/* -------------------------------------------------------------------- city */

/**
 * @param {Set<string>} visibleIds  ids of facilities matching the current filters.
 *
 * The panel must agree with the marker that opened it. Listing every site in the
 * city regardless of filter would show an aluminium smelter under a copper
 * filter — so non-matching sites are counted and named, but kept separate.
 */
export function cityPanel(model, cityKey, stage, visibleIds) {
  const city = model.cityByKey.get(cityKey);
  if (!city) return empty('City not found');

  const all = model.facilities.filter((f) => f.cityKey === cityKey);
  const atStage = stage ? all.filter((f) => f.stage === stage) : all;

  const shown = visibleIds ? atStage.filter((f) => visibleIds.has(f.id)) : atStage;
  const hidden = all.filter((f) => !shown.includes(f));

  if (shown.length === 0) return empty('No matching sites here', 'Nothing at this location matches your filters.');

  const stages = [...new Set(shown.map((f) => f.stage))];

  return `
    <h2>${esc(city.name)}</h2>
    <div class="sub">
      <span class="muted">${esc(city.country)}</span>
      <span class="faint">&middot;</span>
      <span class="muted">${plural(shown.length, 'site')}</span>
    </div>
    <div class="sub">${stages.map(stageChip).join('')}</div>
    <h3>Sites</h3>
    ${shown.map((f) => facilityDetail(f, model.elementById)).join('')}
    ${hidden.length
      ? `<h3>Also at this location</h3>
         <p class="faint">Hidden by your current filters:</p>
         <div class="sitelist">${hidden.map((f) => facilityCard(f, model.elementById)).join('')}</div>`
      : ''}
    <p class="faint panel-foot">
      Coordinates are city-level. This dataset does not record street addresses.
    </p>`;
}

/* ----------------------------------------------------------------- company */

export function companyPanel(model, companyKey, news) {
  const company = model.companyByKey.get(companyKey);
  if (!company) return empty('Company not found');

  const list = company.facilities;
  const countries = [...new Set(list.map((f) => f.country))].sort();
  const elements = [...new Set(list.flatMap((f) => f.elements))];
  const byStage = STAGES.map((s) => ({ stage: s, items: list.filter((f) => f.stage === s) })).filter(
    (g) => g.items.length
  );

  const newsBlock = renderNews(company, news);

  return `
    <div class="cohead">
      ${companyLogo(company)}
      <div class="cohead__text">
        <h2>${esc(company.name)}</h2>
        ${company.hq_country ? `<div class="cohead__hq">${esc(company.hq_country)}</div>` : ''}
      </div>
    </div>
    <div class="sub">
      ${maturityChip(company.maturity)}
      ${companyStatusChip(company)}
      ${company.type ? `<span class="muted">${esc(company.type)}</span>` : ''}
    </div>
    ${company.website
      ? `<p><a href="${esc(company.website)}" target="_blank" rel="noopener noreferrer">${esc(
          company.website.replace(/^https?:\/\//, '')
        )} &nearr;</a></p>`
      : ''}

    <div class="stat-row">
      <div class="stat"><div class="stat__n">${list.length}</div><div class="stat__l">${
        list.length === 1 ? 'site' : 'sites'
      }</div></div>
      <div class="stat"><div class="stat__n">${countries.length}</div><div class="stat__l">${
        countries.length === 1 ? 'country' : 'countries'
      }</div></div>
      <div class="stat"><div class="stat__n">${elements.length}</div><div class="stat__l">materials</div></div>
    </div>

    <h3>Materials handled</h3>
    <div class="sub">${elementChips(elements, model.elementById)}</div>

    <h3>Sites</h3>
    ${byStage
      .map(
        (g) => `<div class="sitegroup">
          <div class="sitegroup__head">${stageChip(g.stage)}</div>
          <div class="sitelist">${g.items.map((f) => facilityCard(f, model.elementById)).join('')}</div>
        </div>`
      )
      .join('')}

    ${newsBlock}`;
}

function renderNews(company, news) {
  const entry = news?.companies?.[company.key];
  const items = entry?.items || [];
  const searchUrl = `https://news.google.com/search?q=${encodeURIComponent(
    company.news_query || company.name
  )}`;

  if (items.length === 0) {
    // An empty box helps nobody: say why there is nothing, and still offer a way through.
    return `<h3>Recent announcements</h3>
      <p class="faint">
        No feed set for this company. Paste its newsroom RSS address into the
        <code>news_feed</code> column of <code>data/companies.csv</code> to show
        its announcements here.
      </p>
      <p><a href="${esc(searchUrl)}" target="_blank" rel="noopener noreferrer">Search the news for ${esc(
        company.name
      )} &nearr;</a></p>`;
  }

  const fetched = entry.fetched_at ? `Updated ${relativeDate(entry.fetched_at)}` : '';

  return `<h3>Recent announcements</h3>
    <div class="news">
      ${items
        .map(
          (i) => `<div class="news__item">
            <a class="news__title" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">${esc(
              i.title
            )}</a>
            <div class="news__meta">${esc(i.source || '')}${
              i.published ? ` &middot; ${esc(formatDate(i.published))}` : ''
            }</div>
          </div>`
        )
        .join('')}
    </div>
    <p class="faint panel-foot">
      ${esc(fetched)} &middot; from the company's own newsroom feed
      &middot; <a href="${esc(searchUrl)}" target="_blank" rel="noopener noreferrer">search the news &nearr;</a>
    </p>`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function relativeDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

/* ---------------------------------------------------------------- material */

export function elementPanel(model, elementId, { productionStage } = {}) {
  const el = model.elementById.get(elementId);
  if (!el) return empty('Material not found');

  const sites = model.facilities.filter((f) => f.elements.includes(el.id));
  const stageCounts = STAGES.map((s) => ({
    stage: s,
    n: sites.filter((f) => f.stage === s).length,
  })).filter((s) => s.n > 0);

  const stagesWithData = productionStages(el);
  const activeStage = productionStage && stagesWithData.includes(productionStage)
    ? productionStage
    : stagesWithData[0];
  const years = productionYears(el, activeStage);
  const latestYear = years[years.length - 1];

  const shares = activeStage ? productionShares(el, { stage: activeStage, year: latestYear }) : null;
  const series = activeStage ? productionSeries(el, { stage: activeStage }) : [];

  const stageTabs =
    stagesWithData.length > 1
      ? `<div class="minitabs">${stagesWithData
          .map(
            (s) =>
              `<button data-act="prod-stage" data-id="${esc(s)}" aria-selected="${s === activeStage}">${esc(
                s
              )}</button>`
          )
          .join('')}</div>`
      : '';

  // Notes here are addressed to whoever is reading the factsheet, not to
  // whoever maintains the CSV. "Add more years to data/production.csv" appeared
  // under every material, since only one year is recorded for all of them, and
  // promised a trend line that no reader could produce.
  const productionBlock = !activeStage
    ? `<p class="faint">Who produces ${esc(el.name)} is not recorded in this dataset.</p>`
    : `${stageTabs}
       ${donutChart(shares, {
         title: `Share of world ${activeStage}`,
         subtitle: `${latestYear} · indicative figures, verify against the sources below`,
       })}
       ${years.length >= 2
         ? lineChart(series, { title: 'Over time', unit: shares.unit })
         : `<p class="faint idx">
              A single year, ${latestYear}, so there is no trend to plot. The sources
              below carry the full series.
            </p>`}`;

  return `
    <h2>${esc(el.name)}${el.symbol ? ` <span class="faint">${esc(el.symbol)}</span>` : ''}</h2>
    <div class="sub">
      ${el.strategic ? '<span class="chip chip--strategic">&#9733; Strategic</span>' : ''}
      <span class="chip">${esc(el.category.replace(/-/g, ' '))}</span>
    </div>

    ${el.summary ? `<p>${esc(el.summary)}</p>` : ''}

    <h3>What it is used for</h3>
    <ul class="uses">${el.uses.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>

    <h3>Who controls supply</h3>
    ${productionBlock}

    <h3>EU position</h3>
    ${meter('Import reliance', el.indicators.eu_import_reliance_pct, {
      danger: 70,
      hint: 'Share of EU supply that comes from outside the EU.',
    })}
    ${meter('End-of-life recycling input rate', el.indicators.eol_recycling_input_rate_pct, {
      danger: 101,
      hint: 'Share of EU demand met by recycling old scrap.',
    })}
    ${el.indicators.substitution_index !== null
      ? `<p class="faint idx">Substitution index ${el.indicators.substitution_index} — closer to 1 means harder to replace.</p>`
      : ''}
    ${el.eu_note ? `<p>${esc(el.eu_note)}</p>` : ''}

    <h3>In Europe</h3>
    ${sites.length === 0
      ? `<p class="faint">
           No European site in this dataset handles ${esc(el.name)}, so the map is empty while
           this factsheet is open.
         </p>`
      : `<div class="stagecounts">
          ${stageCounts
            .map(
              (s) => `<div class="stagecount" style="--stage-c: var(--stage-${s.stage})">
                <span class="stagecount__icon">${stageIcon(s.stage, { size: 14 })}</span>
                <span class="stagecount__n">${s.n}</span>
                <span class="stagecount__l">${STAGE_LABELS[s.stage]}</span>
              </div>`
            )
            .join('')}
        </div>
        <p class="faint idx">
          The map is filtered to ${plural(sites.length, 'site')} handling ${esc(el.name)}.
          Widen it again with <em>Select all</em> under Material.
        </p>`}

    <h3>Sources</h3>
    <div class="srcs">
      ${el.sources
        .map(
          (s) =>
            `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} &nearr;</a>`
        )
        .join('')}
    </div>
    <p class="faint panel-foot">
      Figures are indicative and were compiled from public sources, not measured.
      Check them against the links above before citing.
    </p>`;
}
