/**
 * The map: bundled GeoJSON basemap, no tile server, and one marker per
 * city-and-stage pair.
 *
 * Grouping by city *and* stage is deliberate. Grouping by city alone would
 * collapse Hamburg's smelter and its recycling plant into a single dot that
 * cannot honestly be given one colour; grouping per facility would stack four
 * markers on the same coordinate, because the dataset is only city-precise.
 */

import { stageIcon, STAGES, STAGE_LABELS, STAGE_DESCRIPTIONS } from './icons.js';

const EUROPE_CENTRE = [56.5, 12];

/** Zoom 4 crops Europe badly on a phone-width viewport, so start further out. */
function preferredZoom() {
  if (typeof window === 'undefined') return 4;
  return window.innerWidth < 700 ? 3 : 4;
}

// Must stay inside the clip box used by scripts/build-europe-geo.mjs, so the
// straight edges left by clipping are never reachable.
const MAX_BOUNDS = [
  [8, -50],
  [86, 80],
];

let map = null;
let basemapLayer = null;
let markerLayer = null;
const markersByKey = new Map();
let selectedKey = null;

/** Marker diameter in px at a given zoom. Small when zoomed out, or dense
 *  regions like the Low Countries turn into one unreadable blob. */
function markerSizeForZoom(z) {
  if (z <= 3) return 17;
  if (z === 4) return 21;
  if (z === 5) return 25;
  if (z === 6) return 29;
  return 33;
}

function applyMarkerSize() {
  if (!map) return;
  map.getContainer().style.setProperty('--marker-size', `${markerSizeForZoom(map.getZoom())}px`);
}

export function initMap() {
  map = L.map('map', {
    center: EUROPE_CENTRE,
    zoom: preferredZoom(),
    minZoom: 2,
    maxZoom: 9,
    maxBounds: MAX_BOUNDS,
    maxBoundsViscosity: 0.75,
    zoomControl: true,
    attributionControl: true,
    worldCopyJump: false,
    // The basemap has no tiles, so fractional zoom just blurs the outlines.
    zoomSnap: 1,
  });

  map.attributionControl.setPrefix('');
  map.attributionControl.addAttribution(
    'Boundaries: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>'
  );

  markerLayer = L.layerGroup().addTo(map);

  map.on('zoomend', applyMarkerSize);
  map.on('zoomend', updateCityLabels);
  map.on('resize', applyMinZoom);
  watchContainerSize();
  applyMinZoom();
  applyMarkerSize();

  return map;
}

/**
 * Keep Leaflet's idea of its own size in step with the element.
 *
 * The map container is a CSS grid track: opening a panel or collapsing the
 * sidebar changes its width with no window resize event, so Leaflet never
 * recalculates. Its projection origin then goes stale and markers are drawn
 * against the wrong origin — they visibly detach from the countries beneath
 * them. Watching the element itself covers every cause at once, rather than
 * remembering to call invalidateSize() at each call site that might resize it.
 */
function watchContainerSize() {
  if (typeof ResizeObserver === 'undefined') return;
  let first = true;
  const observer = new ResizeObserver(() => {
    if (first) {
      first = false; // the initial callback fires at the current size
      return;
    }
    map.invalidateSize({ animate: false });
  });
  observer.observe(map.getContainer());
}

/**
 * Zoom floor, per screen size.
 *
 * Zooming out far enough reveals the straight edges left by clipping the source
 * data. Deriving the floor from the viewport sounded right but is dominated by
 * a phone's tall, narrow aspect, which forced the map in rather than out. A
 * floor equal to the starting zoom is both simpler and correct: at that zoom the
 * clip edges sit outside the view on every screen size, and maxBounds stops you
 * panning to them.
 */
function applyMinZoom() {
  if (!map) return;
  const floor = preferredZoom();
  map.setMinZoom(floor);
  if (map.getZoom() < floor) map.setZoom(floor);
}

export function getMap() {
  return map;
}

/* ------------------------------------------------------------------ basemap */

export function renderBasemap(geojson) {
  if (basemapLayer) basemapLayer.remove();

  basemapLayer = L.geoJSON(geojson, {
    interactive: true,
    style: () => ({
      className: 'country',
      color: 'rgba(255,255,255,0.72)',
      weight: 1,
      opacity: 1,
      fill: true,
      fillColor: '#ffffff',
      fillOpacity: 0.015,
    }),
    onEachFeature: (feature, layer) => {
      const name = feature.properties?.name;
      if (!name) return;

      // Hover only. Countries are not clickable: filtering by a stray click
      // while panning the map was a persistent nuisance, and the filter panel
      // already does this deliberately.
      layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.07 }));
      layer.on('mouseout', () => layer.setStyle({ fillOpacity: layer.options._tint ?? 0.015 }));
      layer.bindTooltip(name, { sticky: true, direction: 'top', opacity: 0.9, className: 'country-tip' });
    },
  }).addTo(map);

  // Countries sit under the markers.
  basemapLayer.bringToBack();
  return basemapLayer;
}

const BASE_FILL = 0.015;
const MAX_TINT = 0.1;

/**
 * Tint countries by how many matching sites they hold.
 *
 * Only worth doing when the selection is narrow enough for the pattern to mean
 * something — with everything shown, almost every country has a site and the
 * whole map turns grey, which destroys the outline cartography for no
 * information gain. So `enabled` is false unless a single material is selected,
 * where the question "who has the lithium" actually has a visible answer.
 */
export function tintCountries(countsByCountry, { enabled = false } = {}) {
  if (!basemapLayer) return;
  const max = enabled ? Math.max(0, ...Object.values(countsByCountry || {})) : 0;

  basemapLayer.eachLayer((layer) => {
    const name = layer.feature?.properties?.name;
    const n = (countsByCountry && countsByCountry[name]) || 0;
    // Square root keeps a country with one site visible next to one with twenty.
    const tint = enabled && max > 0 && n > 0
      ? BASE_FILL + MAX_TINT * Math.sqrt(n / max)
      : BASE_FILL;
    layer.options._tint = tint;
    layer.setStyle({ fillOpacity: tint });
  });
}

/* ------------------------------------------------------------------- cities */

let cityLayer = null;

/**
 * Capital cities, as a quiet orientation layer. Labels only appear once you
 * zoom in, so the default view stays as clean as the mockup — the point is to
 * be able to place a site relative to somewhere you know, not to label Europe.
 */
export function renderCities(cities) {
  if (cityLayer) cityLayer.remove();
  const capitals = cities.filter((c) => c.is_capital);

  cityLayer = L.layerGroup(
    capitals.map((c) =>
      L.marker([c.lat, c.lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'city-pin',
          iconSize: null,
          html: `<div class="city-dot"><i></i><span>${c.name}</span></div>`,
        }),
      })
    )
  ).addTo(map);

  cityLayer.eachLayer((l) => l.setZIndexOffset(-500));
  updateCityLabels();
  return cityLayer;
}

function updateCityLabels() {
  if (!map) return;
  map.getContainer().classList.toggle('show-city-labels', map.getZoom() >= 5);
}

/* ------------------------------------------------------------------ markers */

function markerHtml(group) {
  const count = group.facilities.length;
  const badge = count > 1 ? `<span class="marker__count">${count}</span>` : '';
  // --stage-c drives every colour in the marker; without it the CSS falls back
  // to inherited white and the pictogram loses its meaning.
  return `<div class="marker-pin" data-key="${group.key}" style="--stage-c: var(--stage-${group.stage})">
    <div class="marker">${stageIcon(group.stage)}${badge}</div>
  </div>`;
}

let lastSignature = '';

/**
 * @param {Array} groups  [{ key, city, stage, facilities }]
 *
 * Rebuilds only when the set of markers actually changed. Selecting a marker
 * also triggers a render, and blindly clearing the layer there would destroy
 * the popup the same click just opened.
 */
export function renderMarkers(groups, { onSelect } = {}) {
  const signature = groups.map((g) => `${g.key}:${g.facilities.length}`).join('|');
  if (signature === lastSignature) return;
  lastSignature = signature;

  markerLayer.clearLayers();
  markersByKey.clear();

  for (const group of groups) {
    const icon = L.divIcon({
      html: markerHtml(group),
      className: 'crm-pin',
      // Zero-size icon: the inner element centres itself with a CSS transform,
      // which lets the marker resize on zoom without rebuilding every icon.
      iconSize: null,
    });

    const marker = L.marker([group.city.lat, group.city.lon], {
      icon,
      title: `${group.city.name} — ${STAGE_LABELS[group.stage] || group.stage}`,
      riseOnHover: true,
      keyboard: true,
      alt: `${STAGE_LABELS[group.stage] || group.stage} in ${group.city.name}`,
    });

    marker.on('click', () => onSelect && onSelect(group));
    marker.addTo(markerLayer);
    markersByKey.set(group.key, marker);
  }

  applySelectionClass();
}

function applySelectionClass() {
  for (const [key, marker] of markersByKey) {
    const el = marker.getElement()?.querySelector('.marker-pin');
    if (el) el.classList.toggle('is-selected', key === selectedKey);
  }
}

export function setSelected(key) {
  selectedKey = key;
  applySelectionClass();
}

export function openPopupAt(key, html) {
  const marker = markersByKey.get(key);
  if (!marker) return;
  marker.bindPopup(html, { closeButton: true, autoPanPadding: [40, 40], maxWidth: 300 }).openPopup();
}

export function closePopup() {
  if (map) map.closePopup();
}

/* ------------------------------------------------------------- navigation */

export function flyToCity(city, zoom = 6) {
  if (!map || !city) return;
  map.flyTo([city.lat, city.lon], Math.max(map.getZoom(), zoom), { duration: 0.6 });
}

export function fitToGroups(groups) {
  if (!map || !groups?.length) return;
  const bounds = L.latLngBounds(groups.map((g) => [g.city.lat, g.city.lon]));
  map.fitBounds(bounds, { padding: [60, 60], maxZoom: 6 });
}

export function resetView() {
  if (!map) return;
  map.closePopup();
  map.setView(EUROPE_CENTRE, Math.max(preferredZoom(), map.getMinZoom()), { animate: true });
}

export function invalidate() {
  if (map) map.invalidateSize();
}

/* ----------------------------------------------------------------- legend */

export function renderLegend(container, activeStages) {
  // An empty selection means none are active, not all of them. Falling back to
  // "all" here would leave the legend fully lit with an empty map beneath it.
  const active = new Set(activeStages || STAGES);

  // Built once. Rewriting innerHTML on every render dismissed the row tooltip
  // mid-hover, and the only thing that actually changes here is which rows are
  // dimmed.
  if (!container.firstElementChild) {
    container.innerHTML = `
      <div class="legend__title">Stage of the chain</div>
      ${STAGES.map(
        (s) => `
        <div class="legend__row" data-stage="${s}" style="--stage-c: var(--stage-${s})"
             title="${STAGE_DESCRIPTIONS[s]}">
          <span class="legend__dot">${stageIcon(s)}</span>
          <span>${STAGE_LABELS[s]}</span>
        </div>`
      ).join('')}
    `;
  }

  for (const row of container.querySelectorAll('.legend__row')) {
    const off = String(!active.has(row.dataset.stage));
    if (row.dataset.off !== off) row.dataset.off = off;
  }
}
