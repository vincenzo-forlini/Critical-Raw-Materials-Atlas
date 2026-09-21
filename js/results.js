/**
 * The results list, tabbed between sites and companies.
 *
 * The Companies tab is the direct answer to "which companies deal with this
 * material or this process": it aggregates whatever the filters currently
 * select, so it always reflects the map.
 */

import { groupByCompany } from './data.js';
import { STAGE_LABELS } from './icons.js';
import {
  esc, stageChip, statusChip, elementChips, confidenceBadge, empty, plural, maturityChip,
  crmaChip, companyStatusChip, rcard, companyLink,
} from './ui.js';

export function renderResults(container, model, state, facilities) {
  if (facilities.length === 0) {
    // Name the category that is actually empty, rather than guessing at the cause.
    const emptied = ['elements', 'stages', 'countries', 'statuses', 'maturities', 'crma'].filter(
      (f) => state[f].size === 0
    );
    const labels = { elements: 'material', stages: 'stage', countries: 'country',
                     statuses: 'status', maturities: 'company type', crma: 'project listing' };
    container.innerHTML = empty(
      'Nothing matches',
      emptied.length
        ? `Every ${emptied.map((f) => labels[f]).join(' and ')} is deselected. Use "Select all" to bring them back.`
        : 'Try removing a filter, or widening the selection.'
    );
    return;
  }

  const tab = state.resultsTab;
  const companies = groupByCompany(facilities);

  const head = `<div class="segmented segmented--sub" role="tablist">
    <button role="tab" data-act="results-tab" data-id="facilities" aria-selected="${tab === 'facilities'}">
      Sites <span class="pill">${facilities.length}</span>
    </button>
    <button role="tab" data-act="results-tab" data-id="companies" aria-selected="${tab === 'companies'}">
      Companies <span class="pill">${companies.length}</span>
    </button>
  </div>`;

  container.innerHTML = head + (tab === 'companies'
    ? renderCompanies(companies, model)
    : renderFacilities(facilities, model, state));
}

function renderFacilities(facilities, model, state) {
  const sorted = [...facilities].sort(
    (a, b) => a.country.localeCompare(b.country) || a.city.name.localeCompare(b.city.name)
  );

  return `<div class="rlist">
    ${sorted
      .map((f) =>
        rcard({
          act: 'focus-facility',
          id: f.id,
          label: `Show ${f.name} on the map`,
          current: state.selectedKey === `${f.cityKey}::${f.stage}`,
          body: `
          <div class="rcard__top">
            <span class="rcard__name">${esc(f.name)}</span>
            ${statusChip(f.status)}
          </div>
          <div class="rcard__where">${companyLink(f.company)} &middot; ${esc(f.city.name)}, ${esc(f.country)}</div>
          <div class="rcard__meta">
            ${companyStatusChip(f.company)}
            ${crmaChip(f, { compact: true })}
            ${stageChip(f.stage)}
            ${elementChips(f.elements, model.elementById, { max: 3 })}
          </div>`,
        })
      )
      .join('')}
  </div>`;
}

function renderCompanies(companies, model) {
  return `<div class="rlist">
    ${companies
      .map((g) => {
        const stages = [...g.stages];
        const countries = [...g.countries].sort();
        return rcard({
          act: 'open-company',
          id: g.company.key,
          label: `Open ${g.company.name}`,
          body: `
          <div class="rcard__top">
            <span class="rcard__name">${esc(g.company.name)}</span>
            ${maturityChip(g.company.maturity)}
            ${companyStatusChip(g.company)}
            <span class="pill">${plural(g.facilities.length, 'site')}</span>
          </div>
          <div class="rcard__where">${esc(countries.join(', '))}</div>
          <div class="rcard__meta">
            ${stages.map(stageChip).join('')}
            ${elementChips([...g.elements], model.elementById, { max: 3 })}
          </div>`,
        });
      })
      .join('')}
  </div>`;
}
