/**
 * Sunset & Sail Travel — script.js
 * Version: 3.0 · 2026-10-17
 *
 * Responsibilities:
 *  1. Enhance the Featured Cruises module with a live
 *     estimate engine (anchor price + preference deltas)
 *  2. Enforce price freshness (expires → stale fallback UI)
 *  3. Handle the quote request form (incl. estimate snapshot)
 *  4. Packing checklist drawer (unchanged feature set)
 *
 * PRICING MODEL:
 *  - Anchor price ships in index.html (static, crawlable, honest)
 *  - data/bundles.json supplies the adjustment deltas
 *  - Estimate = anchor + Σ(signed deltas for 6 dimensions)
 *  - Estimates are labelled "estimate"; only the advisor's written
 *    offer is firm.
 *
 * CHANGES v3.0:
 *  - REMOVED: tiered FALLBACK_BUNDLES catalog + renderBundles()
 *    (budget ranges retired as display mechanism)
 *  - ADDED:   estimator engine, staleness clock, air-restriction
 *             combinatorics, quote snapshot, segmented-control
 *             fallback, print-checklist class gate
 */

/* ------------------------------------------------------------------
 * CONFIG
 * ------------------------------------------------------------------ */
const API_CONFIG = {
  baseUrl: 'https://api.sunsetsailtravel.example/v1',
  endpoints: {
    bundles: '/bundles',        // GET  → { price_stale, featuredCruises, ... }
    quotes:  '/quote-requests'  // POST → quote request
  },
  timeoutMs: 6000,
  localCatalog: '/data/bundles.json'
};

/* Dimensions of the estimate, in display/breakdown order */
const ESTIMATE_DIMENSIONS = [
  'homeAirport',
  'dateFlexibility',
  'airMode',
  'cabinCategory',
  'occupancy',
  'hotelNights'
];

const STALE_POLL_MS = 60 * 60 * 1000; // re-check expiry hourly

/* ------------------------------------------------------------------
 * STATE
 * ------------------------------------------------------------------ */
let cruiseData = null; // parsed bundles.json (or API response)

/* ------------------------------------------------------------------
 * DATA LOADING
 *  Try API → fall back to local data/bundles.json → stay static.
 *  Static HTML already carries anchor prices, so total failure
 *  degrades gracefully (estimator simply never initializes).
 * ------------------------------------------------------------------ */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadCruiseData() {
  try {
    const res = await fetchWithTimeout(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.bundles}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json && Array.isArray(json.featuredCruises)) return json;
    throw new Error('Unexpected API shape');
  } catch (err) {
    console.info('Bundles API unavailable, trying local catalog.', err.message);
    try {
      const res = await fetch(API_CONFIG.localCatalog);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json && Array.isArray(json.featuredCruises)) return json;
      throw new Error('Local catalog missing featuredCruises');
    } catch (err) {
      console.warn('Estimator disabled — static anchor prices remain.', err.message);
      return null;
    }
  }
}

/* ------------------------------------------------------------------
 * ESTIMATOR ENGINE
 * ------------------------------------------------------------------ */

/** Parse an ISO-ish timestamp leniently ('2026-10-31', full ISO, etc.) */
function parseTs(value) {
  if (!value) return NaN;
  const t = Date.parse(String(value).length <= 10 ? `${value}T00:00:00Z` : value);
  return t;
}

/** Anchor defaults: explicit in data, else infer (delta 0 key, else first). */
function anchorDefaults(cruise) {
  const explicit = cruise.anchorDefaults || cruise.anchorPrice?.defaults;
  const out = {};
  ESTIMATE_DIMENSIONS.forEach(dim => {
    if (explicit && explicit[dim]) { out[dim] = explicit[dim]; return; }
    const map = cruise.priceAdjustments?.[dim];
    if (!map) return;
    const zero = Object.keys(map).find(k => map[k] === 0);
    out[dim] = zero || Object.keys(map)[0];
  });
  return out;
}

/** Is cruise-line air selectable from this gateway? */
function airAllowed(cruise, dim, key, selections) {
  const program = cruise.airProgram;
  if (!program || dim !== 'airMode') return true;
  if (key !== 'cruise_line_air') return true;
  const gateway = selections.homeAirport;
  if (!gateway || !program.restrictedGateways) return true;
  return program.restrictedGateways.includes(gateway);
}

/** Recompute the estimate for one cruise card and repaint its UI. */
function computeEstimate(cruise, cardEl) {
  const defaults = anchorDefaults(cruise);
  const selections = {};
  let anchor = cruise.anchorPrice?.amount ?? null;
  if (typeof anchor !== 'number') { disableEstimator(cardEl, cruise); return; }

  let violation = null;
  let total = anchor;

  ESTIMATE_DIMENSIONS.forEach(dim => {
    const select = cardEl.querySelector(`[data-dimension="${dim}"]`);
    const val = select ? select.value : defaults[dim];
    selections[dim] = val;
    const delta = cruise.priceAdjustments?.[dim]?.[val];
    if (typeof delta !== 'number') {
      if (val != null) console.warn(`Missing delta: ${cruise.id}.${dim}.${val}`);
    } else {
      total += delta;
    }
    // Air-program combinatorics
    if (dim === 'airMode' && !airAllowed(cruise, dim, val, selections)) {
      violation = val;
    }
  });

  const note = cardEl.querySelector('.field-note');
  const airSelect = cardEl.querySelector('[data-dimension="airMode"]');
  if (airSelect) {
    const badOpt = airSelect.querySelector('option[value="cruise_line_air"]');
    if (badOpt) {
      badOpt.disabled = !airAllowed(cruise, 'airMode', 'cruise_line_air', selections);
    }
  }
  if (violation) {
    if (note) {
      note.textContent = `Cruise-line air isn't available from ${selections.homeAirport}. ` +
        `Choose independent air or cruise-only.`;
      note.dataset.reason = 'air-restricted';
    }
    // Hold the last valid estimate rather than showing a bogus total
    return;
  } else if (note && note.dataset.reason === 'air-restricted') {
    note.textContent = note.dataset.defaultText || '';
    delete note.dataset.reason;
  }

  /* Breakdown: anchor line + one line per non-zero delta */
  const lines = [{ label: 'Anchor price', amount: anchor }];
  ESTIMATE_DIMENSIONS.forEach(dim => {
    const delta = cruise.priceAdjustments?.[dim]?.[selections[dim]];
    if (typeof delta === 'number' && delta !== 0) {
      lines.push({ label: dimensionLabel(dim, selections[dim]), amount: delta });
    }
  });

  const breakdown = cardEl.querySelector('.estimate-breakdown');
  if (breakdown) {
    breakdown.innerHTML =
      lines.map(l => `
        <div class="estimate-line">
          <span>${escapeHtml(l.label)}</span>
          <span class="estimate-value">${fmtDelta(l.amount)}</span>
        </div>`).join('') +
      `<div class="estimate-total">
         <span>Your estimated total</span>
         <span class="estimate-value">${money(total)}</span>
       </div>
       <p class="estimate-caveat">Estimate only — your final price is confirmed
       in a written offer from your advisor.</p>`;
    breakdown.setAttribute('aria-live', 'polite');
  }

  /* Snapshot onto the CTA so the quote form captures selections */
  const cta = cardEl.querySelector('[data-prefill]');
  if (cta) {
    cta.dataset.estimate = total;
    cta.dataset.selections = JSON.stringify(selections);
    cta.dataset.priceAsOf = cruise.asOf || '';
    cta.dataset.validThrough = cruise.expires || '';
  }
}

function dimensionLabel(dim, key) {
  const dict = {
    homeAirport: `From ${key.replace(/_/g, ' ')}`,
    dateFlexibility: 'Date flexibility',
    airMode: key.replace(/_/g, ' '),
    cabinCategory: key.replace(/_/g, ' '),
    occupancy: key.replace(/_/g, ' '),
    hotelNights: key === 'none' ? 'No hotel stay' : `Hotel (${key.replace(/_/g, ' ')})`
  };
  return dict[dim] || key;
}

function money(n) { return `$${Number(n).toLocaleString()}`; }
function fmtDelta(n) { return (n >= 0 ? '+' : '−') + `$${Math.abs(Number(n)).toLocaleString()}`; }

function disableEstimator(cardEl, cruise) {
  console.warn(`No anchor price for ${cruise?.id} — estimator hidden.`);
  cardEl.querySelectorAll('[data-dimension]').forEach(el => el.disabled = true);
  const bd = cardEl.querySelector('.estimate-breakdown');
  if (bd) bd.hidden = true;
}

/* ------------------------------------------------------------------
 * STALENESS
 *  Past expires: hide figures, swap CTA, disable controls.
 *  script-side gate mirrors the build.js/CI server-side gate —
 *  belt and braces for a tab left open overnight.
 * ------------------------------------------------------------------ */
function applyStaleness(cruise, cardEl) {
  const expiry = parseTs(cruise?.expires);
  if (Number.isNaN(expiry)) return;
  const fresh = Date.now() < expiry;

  const validity = cardEl.querySelector('.price-validity');
  if (!fresh) {
    cardEl.classList.add('is-stale');
    cardEl.querySelectorAll('[data-dimension]').forEach(el => el.disabled = true);
    const cta = cardEl.querySelector('[data-prefill]');
    if (cta) {
      cta.textContent = cruise.staleCta || 'Request current pricing';
    }
    const staleMsg = document.createElement('p');
    staleMsg.className = 'price-stale';
    staleMsg.textContent = 'This price window has closed — ask us for today\'s pricing.';
    cardEl.querySelector('.cruise-price-block')?.appendChild(staleMsg);
  } else if (cardEl.classList.contains('is-stale')) {
    // Data got fresher (API refresh mid-session)
    cardEl.classList.remove('is-stale');
    cardEl.querySelectorAll('[data-dimension]').forEach(el => el.disabled = false);
    cardEl.querySelector('.price-stale')?.remove();
  }
}

function startStalenessClock() {
  setInterval(() => {
    if (!cruiseData) return;
    document.querySelectorAll('[data-cruise-id]').forEach(cardEl => {
      const cruise = findCruise(cardEl.dataset.cruiseId);
      if (cruise) applyStaleness(cruise, cardEl);
    });
  }, STALE_POLL_MS);
}

function findCruise(id) {
  return (cruiseData?.featuredCruises || []).find(c => c.id === id);
}

/* ------------------------------------------------------------------
 * WIRING — estimator per card
 * ------------------------------------------------------------------ */
function wireEstimators() {
  document.querySelectorAll('[data-cruise-id]').forEach(cardEl => {
    const cruise = findCruise(cardEl.dataset.cruiseId);
    if (!cruise) return;
    applyStaleness(cruise, cardEl);

    const note = cardEl.querySelector('.field-note');
    if (note) note.dataset.defaultText = note.textContent;

    cardEl.querySelectorAll('[data-dimension]').forEach(select => {
      select.addEventListener('change', () => computeEstimate(cruise, cardEl));
    });
    computeEstimate(cruise, cardEl); // initial paint (should equal anchor)
  });
}

/* ------------------------------------------------------------------
 * QUOTE FORM
 *  Submits to API; falls back to mailto. Attaches a snapshot of the
 *  visitor's estimate context (cruise, selections, total, validity
 *  window) so the advisor rebuilds the exact figure they saw.
 * ------------------------------------------------------------------ */
async function submitQuote(payload) {
  try {
    const res = await fetchWithTimeout(
      `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.quotes}`,
      { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
  } catch (err) {
    console.warn('Quote API unavailable; falling back to mailto handoff.', err);
    return { ok: false, payload };
  }
}

function collectSnapshot(ctaData) {
  if (!ctaData?.estimate) return null;
  return {
    cruiseId: ctaData.prefill,
    estimateTotal: Number(ctaData.estimate),
    selections: JSON.parse(ctaData.selections || '{}'),
    priceAsOf: ctaData.priceAsOf,
    validThrough: ctaData.validThrough
  };
}

function wireQuoteForm() {
  const form = document.getElementById('quoteForm');
  const status = document.getElementById('formStatus');
  if (!form) return;

  /* Prefill from any cruise CTA click */
  document.querySelectorAll('[data-prefill]').forEach(cta => {
    cta.addEventListener('click', () => {
      const select = document.getElementById('qInterest');
      if (select) select.value = cta.dataset.prefill;
      const lastSnap = collectSnapshot(cta.dataset);
      if (lastSnap) {
        document.getElementById('qEstimateSnapshot').value = JSON.stringify(lastSnap);
      }
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    const consentCheckbox = document.getElementById('qConsent');
    if (!consentCheckbox || !consentCheckbox.checked) {
      status.className = 'error';
      status.textContent = 'Please accept the privacy consent to continue.';
      consentCheckbox.focus();
      return;
    }

    const formData = Object.fromEntries(new FormData(form));
    formData.partySize = Number(formData.partySize) || 2;
    formData.submittedAt = new Date().toISOString();
    if (formData.estimateSnapshot) {
      try { formData.estimateSnapshot = JSON.parse(formData.estimateSnapshot); } catch (_) {}
    }

    status.className = '';
    status.textContent = 'Sending your request…';
    const result = await submitQuote(formData);

    if (result.ok) {
      status.className = 'success';
      status.textContent = 'Thanks! Your quote request was received — expect a reply within 1 business day.';
      form.reset();
    } else {
      const s = formData.estimateSnapshot || {};
      const subject = encodeURIComponent(
        `Quote request: ${formData.bundle || s.cruiseId || 'vacation bundle'} (${formData.partySize} travelers)`);
      const body = encodeURIComponent(
        `Name: ${formData.name}\n` +
        `Email: ${formData.email}\n` +
        `Phone: ${formData.phone || 'Not provided'}\n` +
        `Departure: ${formData.departureCity}\n` +
        `Bundle Interest: ${formData.bundle || 'Not specified'}\n` +
        `Travelers: ${formData.partySize}\n` +
        `Preferred Dates: ${formData.preferredDates || 'Flexible'}\n` +
        `Budget Tier: ${formData.budgetTier || 'Not specified'}\n` +
        (s.estimateTotal ? `Estimated Total Seen: ${money(s.estimateTotal)} ` +
          `(prices as of ${s.priceAsOf || 'n/a'}, valid through ${s.validThrough || 'n/a'})\n` +
          `Selections: ${JSON.stringify(s.selections)}\n` : '') +
        `Traveler Info: ${formData.travelerInfo || 'Not provided'}\n` +
        `Notes: ${formData.notes}`
      );
      window.location.href = `mailto:quotes@sunsetsailtravel.example?subject=${subject}&body=${body}`;
      status.textContent = 'Opening your email app to finish sending the request…';
    }
  });
}

/* ------------------------------------------------------------------
 * SEGMENTED CONTROL — .is-checked fallback for engines without :has()
 * ------------------------------------------------------------------ */
function wireSegmentedControls() {
  document.querySelectorAll('.segmented').forEach(group => {
    const labels = group.querySelectorAll('label');
    const sync = () => labels.forEach(l => {
      const input = l.querySelector('input[type="radio"]');
      if (input) l.classList.toggle('is-checked', input.checked);
    });
    group.addEventListener('change', sync);
    sync();
  });
}

/* ------------------------------------------------------------------
 * CAROUSEL CONTROLS — arrow-key + button scrolling (mobile row)
 * ------------------------------------------------------------------ */
function wireCarouselControls() {
  const track = document.querySelector('.cruise-carousel');
  const controls = document.querySelector('.carousel-controls');
  if (!track || !controls) return;
  const step = () => (track.querySelector('.cruise-card')?.offsetWidth || 320) + 20;
  controls.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      track.scrollBy({ left: btn.dataset.dir === 'prev' ? -step() : step(), behavior: 'smooth' });
    });
  });
  track.setAttribute('tabindex', '0');
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); track.scrollBy({ left: -step(), behavior: 'smooth' }); }
    if (e.key === 'ArrowRight') { e.preventDefault(); track.scrollBy({ left:  step(), behavior: 'smooth' }); }
  });
}

/* ------------------------------------------------------------------
 * UTILITIES
 * ------------------------------------------------------------------ */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

/* ------------------------------------------------------------------
 * INIT
 * ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', async () => {
  cruiseData = await loadCruiseData();
  wireEstimators();
  wireQuoteForm();
  wireSegmentedControls();
  wireCarouselControls();
  startStalenessClock();
  PackList.init();
});
