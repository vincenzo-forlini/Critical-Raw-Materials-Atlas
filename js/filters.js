/**
 * The filter bar.
 *
 * Every facet is a pill across the top of the page; clicking one drops its
 * option list beneath it. The filters used to be a column of six stacked groups
 * in the sidebar, which had two problems. The column ran to about 1500px of
 * content in a 600px window, so most of it was always out of sight; and opening
 * a material factsheet collapsed the whole sidebar, which took the filters away
 * at the exact moment you had just used them. Across the top the facets cannot
 * be collapsed by anything else on the page, and the sidebar is free to show
 * results.
 *
 * Counts beside each option are computed with that facet's own filter removed
 * (see facetCounts in data.js), so selecting "Lithium" does not make every other
 * material read zero — the counts stay useful for deciding what to add.
 *
 * The option rows are built once and then patched in place. Reassigning
 * innerHTML on every render used to throw away every checkbox on each click,
 * which dropped keyboard focus to <body>: after ticking one country you were
 * sixty tab stops from the next one. Patching leaves the node you are
 * interacting with alone.
 */

import { STAGES, STAGE_LABELS, STAGE_DESCRIPTIONS, stageIcon } from './icons.js';
import { STATUS_VALUES, MATURITY_VALUES, CRMA_VALUES } from './data.js';
import { esc, checkRow } from './ui.js';

/** Plain-language labels for the maturity values. */
export const MATURITY_LABELS = {
  incumbent: 'Established (incumbent)',
  'scale-up': 'Scale-up',
  startup: 'Start-up or spin-off',
};

const CRMA_LABELS = {
  strategic: 'EU Strategic Project',
  'not-listed': 'Not on the list',
};

const statusLabel = (s) => s.replace(/-/g, ' ').replace(/^./, (m) => m.toUpperCase());

/**
 * The pills, left to right. `scroll` caps the option list's height; the two long
 * lists (34 materials, 23 countries) get it, the short ones do not need it.
 */
const FACETS = [
  { id: 'elements', label: 'Material', scroll: true },
  { id: 'stages', label: 'Stage' },
  { id: 'countries', label: 'Country', scroll: true },
  { id: 'statuses', label: 'Status' },
  { id: 'maturities', label: 'Company' },
  { id: 'crma', label: 'EU projects' },
];

/** At most one pill is open at a time. Null means none. */
let openFacetId = null;

/* ----------------------------------------------------------------- options */

function optionsFor(facet, model) {
  switch (facet) {
    case 'elements':
      return [...model.elements]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({ value: e.id, label: e.name, star: e.strategic, group: e.strategic }));
    case 'stages':
      return STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s], stage: s }));
    case 'countries':
      return [...new Set(model.facilities.map((f) => f.country))]
        .sort()
        .map((c) => ({ value: c, label: c }));
    case 'statuses':
      return STATUS_VALUES.map((s) => ({ value: s, label: statusLabel(s) }));
    case 'maturities':
      return MATURITY_VALUES.map((m) => ({ value: m, label: MATURITY_LABELS[m] }));
    case 'crma':
      return CRMA_VALUES.map((v) => ({ value: v, label: CRMA_LABELS[v], star: v === 'strategic' }));
    default:
      return [];
  }
}

/* -------------------------------------------------------------------- build */

/** A stage row carries its own pictogram and colour, so it is not a checkRow. */
function stageRow(o, counts) {
  const n = counts.get(o.value) || 0;
  return `<label class="check" data-empty="${n === 0}" title="${esc(STAGE_DESCRIPTIONS[o.stage])}"
                 style="--stage-c: var(--stage-${o.stage})">
    <input type="checkbox" value="${esc(o.value)}">
    <span class="check__box">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6"
           stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 5"/></svg>
    </span>
    <span class="check__stage">${stageIcon(o.stage, { size: 13 })}</span>
    <span class="check__label">${esc(o.label)}</span>
    <span class="check__n">${n}</span>
  </label>`;
}

function popBody(facet, model, counts) {
  const options = optionsFor(facet, model);

  if (facet === 'stages') return options.map((o) => stageRow(o, counts)).join('');

  const row = (o) =>
    checkRow({ id: o.value, label: o.label, checked: false, count: counts.get(o.value) || 0, star: o.star });

  // Materials are the one list worth splitting: the Act's strategic subset is
  // what most people arrive looking for.
  if (facet === 'elements') {
    const strategic = options.filter((o) => o.group);
    const other = options.filter((o) => !o.group);
    return `<div class="fgroup__sub">Strategic raw materials</div>${strategic.map(row).join('')}
            <div class="fgroup__sub">Other critical raw materials</div>${other.map(row).join('')}`;
  }
  return options.map(row).join('');
}

function buildBar(pills, pops, model, counts) {
  pills.innerHTML = FACETS.map(
    (f) => `<button class="fpill" data-act="facet" data-id="${f.id}" aria-expanded="false"
                    aria-haspopup="true" aria-controls="pop-${f.id}">
      <span class="fpill__k">${esc(f.label)}</span>
      <span class="fpill__v" data-role="value">all</span>
      <svg class="fpill__chev" viewBox="0 0 16 16" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
    </button>`
  ).join('');

  pops.innerHTML = FACETS.map(
    (f) => `<section class="fpop" id="pop-${f.id}" data-facet="${f.id}" role="group"
                     aria-label="${esc(f.label)}" hidden>
      <div class="fgroup__actions">
        <button class="btn btn--sm" data-act="select-all" data-id="${f.id}">Select all</button>
        <button class="btn btn--sm" data-act="deselect-all" data-id="${f.id}">Deselect all</button>
      </div>
      <div class="fpop__list${f.scroll ? ' fpop__list--scroll' : ''}">${popBody(f.id, model, counts[f.id])}</div>
    </section>`
  ).join('');
}

/* -------------------------------------------------------------------- patch */

/** What the pill reads when it is not showing "all". */
function pillValue(facet, state, model, total) {
  const selected = state[facet];
  if (selected.size === total) return 'all';
  if (selected.size === 0) return 'none';
  if (selected.size === 1) {
    const only = [...selected][0];
    const found = optionsFor(facet, model).find((o) => o.value === only);
    return found ? found.label : only;
  }
  return `${selected.size} selected`;
}

function patchBar(pills, pops, model, state, counts) {
  for (const section of pops.querySelectorAll('[data-facet]')) {
    const facet = section.dataset.facet;
    const selected = state[facet];
    const facetCounts = counts[facet];
    if (!selected || !facetCounts) continue;

    let total = 0;
    for (const input of section.querySelectorAll('input[type=checkbox]')) {
      total += 1;
      const on = selected.has(input.value);
      if (input.checked !== on) input.checked = on;

      const row = input.closest('.check');
      if (!row) continue;
      const n = facetCounts.get(input.value) || 0;
      const empty = String(n === 0);
      if (row.dataset.empty !== empty) row.dataset.empty = empty;
      const nEl = row.querySelector('.check__n');
      if (nEl && nEl.textContent !== String(n)) nEl.textContent = String(n);
    }

    const selectAll = section.querySelector('[data-act="select-all"]');
    const deselectAll = section.querySelector('[data-act="deselect-all"]');
    if (selectAll) selectAll.disabled = selected.size === total;
    if (deselectAll) deselectAll.disabled = selected.size === 0;

    const pill = pills.querySelector(`.fpill[data-id="${facet}"]`);
    if (!pill) continue;
    const label = pillValue(facet, state, model, total);
    const valueEl = pill.querySelector('[data-role="value"]');
    if (valueEl && valueEl.textContent !== label) valueEl.textContent = label;
    // A pill that is narrowing the map should look like it, so the state of the
    // filters is readable without opening anything.
    const narrowed = String(selected.size !== total);
    if (pill.dataset.on !== narrowed) pill.dataset.on = narrowed;
    const expanded = String(openFacetId === facet);
    if (pill.getAttribute('aria-expanded') !== expanded) pill.setAttribute('aria-expanded', expanded);
    section.hidden = openFacetId !== facet;
  }
  if (openFacetId) positionPop(pills, pops);
}

/* ------------------------------------------------------------- positioning */

/**
 * The popovers live in a fixed layer rather than inside the bar, because the
 * bar scrolls sideways on a narrow window and would clip them. That means the
 * open one has to be placed by hand under its pill, and flipped to hang from
 * the right edge when it would otherwise run off the side.
 */
function positionPop(pills, pops) {
  const pill = pills.querySelector(`.fpill[data-id="${openFacetId}"]`);
  const pop = pops.querySelector(`#pop-${openFacetId}`);
  if (!pill || !pop) return;

  const r = pill.getBoundingClientRect();
  const margin = 8;
  pop.style.top = `${Math.round(r.bottom + 6)}px`;
  // Measure first, then decide which edge to hang from.
  pop.style.left = '0px';
  pop.style.right = 'auto';
  const width = pop.offsetWidth;
  let left = r.left;
  if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
  if (left < margin) left = margin;
  pop.style.left = `${Math.round(left)}px`;

  // Never taller than the room below the pill. The cap goes on the list rather
  // than the popover, so the Select all / Deselect all row above it stays put
  // and only one scrollbar appears.
  const list = pop.querySelector('.fpop__list');
  if (list) {
    const room = Math.round(window.innerHeight - r.bottom - 34);
    // The long lists get a comfortable cap on a tall window; the short ones are
    // limited only by the room available.
    const cap = list.classList.contains('fpop__list--scroll') ? 270 : room;
    list.style.maxHeight = `${Math.max(120, Math.min(cap, room))}px`;
  }
}

/* ------------------------------------------------------------------ exports */

export function renderFilterBar(pills, pops, model, state, counts) {
  // Guard on the DOM rather than a flag, so a cleared bar rebuilds itself.
  // Both halves are checked: the pills and the popovers are written by the same
  // call but live in different elements, and checking only the pills meant that
  // if the popovers were ever emptied on their own, nothing would put them back
  // — the dropdowns would open empty from then on, permanently.
  if (!pills.firstElementChild || !pops.firstElementChild) {
    buildBar(pills, pops, model, counts);
  }
  pops.hidden = false;
  patchBar(pills, pops, model, state, counts);
}

/** Open a facet's popover, or close it if it is the one already open. */
export function toggleFacet(facet) {
  openFacetId = openFacetId === facet ? null : facet;
}

export function closeFacet() {
  openFacetId = null;
}

export function openFacetIs(facet) {
  return openFacetId === facet;
}

export function anyFacetOpen() {
  return openFacetId !== null;
}
