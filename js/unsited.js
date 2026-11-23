/**
 * The list of Strategic Projects that have no published site.
 *
 * They are designated, and they are not on the map: with no site there is
 * nowhere honest to put a marker. Leaving them out silently would make the map
 * look complete when it is not, so they are listed instead, each with the
 * reason it has no pin.
 *
 * A pill at the right-hand end of the filter bar opens a list that drops down
 * beneath it. The list lives outside the bar, like the facet lists, because the
 * bar scrolls sideways on a narrow window and would clip it. So it is placed by
 * hand under the pill.
 */

import { esc, elementChips } from './ui.js';

const CRMA_STAGE_LABELS = {
  extraction: 'Extraction',
  processing: 'Processing',
  recycling: 'Recycling',
  substitution: 'Substitution',
};

/**
 * @param {HTMLElement} pillHost  slot in the filter bar
 * @param {HTMLElement} pop       the drop-down, outside the bar
 */
export function renderUnsited(pillHost, pop, projects, elementById) {
  if (!pillHost || !pop) return;
  if (!projects || projects.length === 0) {
    pillHost.hidden = true;
    pop.hidden = true;
    return;
  }

  const n = projects.length;
  const items = projects
    .map((p) => {
      const stage = p.crmaStage.map((s) => CRMA_STAGE_LABELS[s] || s).join(' + ');
      const meta = [p.company, p.countries.join(', '), stage].filter(Boolean).map(esc).join(' &middot; ');
      const source = p.source_url
        ? `<a class="unsited__src" href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">Decision ${esc(
            p.decision
          )} &nearr;</a>`
        : `<span class="unsited__src">Decision ${esc(p.decision)}</span>`;
      return `<li class="unsited__item">
          <div class="unsited__name">${esc(p.project)}</div>
          <div class="unsited__meta">${meta}</div>
          <div class="unsited__chips">${elementChips(p.elements, elementById)}</div>
          <p class="unsited__why">${esc(p.reason)}</p>
          ${source}
        </li>`;
    })
    .join('');

  // On a phone only the star and the count show, so the full wording is also
  // the button's name and tooltip.
  const label = `${n} Strategic ${n === 1 ? 'Project' : 'Projects'} not on the map`;
  pillHost.hidden = false;
  pillHost.innerHTML = `
    <button type="button" class="unsited__pill" id="unsited-pill" data-act="unsited-toggle"
            aria-expanded="false" aria-controls="unsited-pop"
            aria-label="${esc(label)}" title="${esc(label)}">
      <span class="unsited__star" aria-hidden="true">&#9733;</span>
      <span aria-hidden="true">${n}<span class="unsited__words"> Strategic ${
        n === 1 ? 'Project' : 'Projects'
      } not on the map</span></span>
      <svg class="unsited__chev" viewBox="0 0 16 16" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
    </button>`;

  pop.hidden = true;
  pop.innerHTML = `
    <p class="unsited__intro">
      Designated under the Critical Raw Materials Act, but no site has been published.
      There is nowhere honest to put a marker, so they are listed here.
    </p>
    <ul class="unsited__list">${items}</ul>`;
}

export function unsitedIsOpen(pop) {
  return !!pop && !pop.hidden;
}

/** Open or close the list. Kept on the elements, like the legend, not in state. */
export function toggleUnsited(pillHost, pop, open = !unsitedIsOpen(pop)) {
  if (!pillHost || !pop) return;
  pop.hidden = !open;
  pillHost.setAttribute('data-open', String(open));
  pillHost.querySelector('.unsited__pill')?.setAttribute('aria-expanded', String(open));
  if (open) positionUnsited(pillHost, pop);
}

/** Hang the list under the pill, right edges aligned, inside the window. */
export function positionUnsited(pillHost, pop) {
  const pill = pillHost.querySelector('.unsited__pill');
  if (!pill || pop.hidden) return;
  const r = pill.getBoundingClientRect();
  // With a factsheet open the bar is narrower and the pill can scroll out of
  // sight. A list hanging from a pill nobody can see is just in the way, so
  // close it.
  const bar = pill.closest('.fbar')?.getBoundingClientRect();
  if (bar && (r.right > bar.right + 1 || r.left < bar.left - 1)) {
    toggleUnsited(pillHost, pop, false);
    return;
  }
  const margin = 8;
  const width = Math.min(360, window.innerWidth - margin * 2);
  let left = r.right - width;
  if (left < margin) left = margin;
  if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
  const top = Math.round(r.bottom + 6);
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${top}px`;
  pop.style.maxHeight = `${Math.max(160, window.innerHeight - top - 16)}px`;
}
