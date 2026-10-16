/**
 * Sunset & Sail Travel — script.js
 * Responsibilities:
 *  1. Load bundle data (API if available, fallback to static catalog)
 *  2. Handle the quote request form
 *  3. Expose a tiny client-side adapter so agents/APIs have a predictable surface
 */

/* ------------------------------------------------------------------
 * CONFIG — point these at your real backend when ready
 * ------------------------------------------------------------------ */
const API_CONFIG = {
  baseUrl: 'https://api.sunsetsailtravel.example/v1',
  endpoints: {
    bundles: '/bundles',       // GET → list of active vacation bundles
    quotes:  '/quote-requests' // POST → submit quote request
  },
  timeoutMs: 6000
};

/* ------------------------------------------------------------------
 * STATIC CATALOG — the "knowledge cluster" fallback.
 * Keep in sync with JSON-LD schema in index.html.
 * ------------------------------------------------------------------ */
const FALLBACK_BUNDLES = [
  {
    id: 'caribbean-bundle',
    name: '7-Night Western Caribbean Cruise Bundle',
    nights: 7,
    region: 'Caribbean',
    summary: 'Round-trip flights, 1-night pre-cruise hotel with transfers, 7-night cruise to Cozumel, Grand Cayman & Jamaica, rental car, two shore excursion tickets.',
    priceTier: 'economy',
    minPrice: 1500,
    maxPrice: 2500,
    currency: 'USD',
    inStock: true,
    includes: ['Round-trip air', 'Pre-cruise hotel', 'Port transfers', 'Rental car', '2 shore excursion tickets', 'Travel insurance']
  },
  {
    id: 'alaska-bundle',
    name: '10-Night Alaska Glacier Cruise Bundle',
    nights: 10,
    region: 'Alaska',
    summary: 'Flights to Seattle, pre-cruise hotel, glacier itinerary, Seattle city tour, post-cruise attraction day pass.',
    priceTier: 'premium',
    minPrice: 2500,
    maxPrice: 4000,
    currency: 'USD',
    inStock: true,
    includes: ['Round-trip air', 'Pre-cruise hotel', 'City tour', 'Attraction day pass', 'Travel insurance']
  },
  {
    id: 'mediterranean-bundle',
    name: '12-Night Mediterranean Grand Tour Bundle',
    nights: 12,
    region: 'Mediterranean',
    summary: 'Flights to Barcelona, 2-night pre-cruise hotel, 12-night cruise, rail pass, skip-the-line tickets.',
    priceTier: 'luxury',
    minPrice: 4000,
    maxPrice: 9999,
    currency: 'USD',
    inStock: false, // Limited availability
    includes: ['Round-trip air', '2 hotel nights', 'Rail pass', 'Attraction tickets', 'Travel insurance']
  }
];

/* ------------------------------------------------------------------
 * DATA LOADING
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

async function loadBundles() {
  try {
    const res = await fetchWithTimeout(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.bundles}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.info('Bundles API unavailable, using static catalog.', err.message);
    return FALLBACK_BUNDLES;
  }
}

function renderBundles(bundles) {
  const grid = document.getElementById('bundleGrid');
  if (!grid || !Array.isArray(bundles)) return;

  grid.innerHTML = bundles.map(b => `
    <article class="bundle-card" data-bundle-id="${b.id}">
      <h3>${escapeHtml(b.name)}</h3>
      <p>${escapeHtml(b.description || b.summary || '')}</p>
      ${b.inStock === false ? '<p class="badge badge-limited">Limited availability</p>' : ''}
      <ul class="bundle-includes">
        ${(b.includes || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')}
      </ul>
      ${b.priceTier ? `
        <p class="price">Budget range: <span>$${Number(b.minPrice).toLocaleString()}–$${Number(b.maxPrice).toLocaleString()}</span> per person (${capitalize(b.priceTier)})</p>
      ` : `
        <p class="price">From <span>$${Number(b.pricePerPerson).toLocaleString()}</span> per person</p>
      `}
      <a class="btn btn-secondary" href="#quote" data-prefill="${b.id}">Ask about this bundle</a>
    </article>
  `).join('');

  // Prefill the quote form when someone clicks a specific bundle
  grid.querySelectorAll('[data-prefill]').forEach(link => {
    link.addEventListener('click', () => {
      const select = document.getElementById('qInterest');
      if (select) select.value = link.dataset.prefill;
    });
  });
}

/* ------------------------------------------------------------------
 * QUOTE FORM
 * ------------------------------------------------------------------ */
async function submitQuote(payload) {
  try {
    const res = await fetchWithTimeout(
      `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.quotes}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
  } catch (err) {
    console.warn('Quote API unavailable; falling back to mailto handoff.', err);
    return { ok: false, payload };
  }
}

function wireQuoteForm() {
  const form = document.getElementById('quoteForm');
  const status = document.getElementById('formStatus');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!form.reportValidity()) return;

    // Validate privacy consent
    const consentCheckbox = document.getElementById('qConsent');
    if (!consentCheckbox || !consentCheckbox.checked) {
      status.textContent = '❌ Please accept the privacy consent to continue.';
      consentCheckbox.focus();
      return;
    }

    const formData = Object.fromEntries(new FormData(form));
    formData.partySize = Number(formData.partySize) || 2;
    formData.submittedAt = new Date().toISOString();

    status.textContent = 'Sending your request…';
    const result = await submitQuote(formData);

    if (result.ok) {
      status.textContent = '✅ Thanks! Your quote request was received — expect a reply within 1 business day.';
      form.reset();
    } else {
      // Human-in-the-loop fallback: open the visitor's email client pre-filled
      const subject = encodeURIComponent(`Quote request: ${formData.bundle || 'vacation bundle'} (${formData.partySize} travelers)`);
      const body = encodeURIComponent(
        `Name: ${formData.name}\n` +
        `Email: ${formData.email}\n` +
        `Phone: ${formData.phone || 'Not provided'}\n` +
        `Departure: ${formData.departureCity}\n` +
        `Bundle Interest: ${formData.bundle || 'Not specified'}\n` +
        `Travelers: ${formData.partySize}\n` +
        `Preferred Dates: ${formData.preferredDates || 'Flexible'}\n` +
        `Budget Tier: ${formData.budgetTier || 'Not specified'}\n` +
        `Traveler Info: ${formData.travelerInfo || 'Not provided'}\n` +
        `Notes: ${formData.notes}`
      );
      window.location.href = `mailto:quotes@sunsetsailtravel.example?subject=${subject}&body=${body}`;
      status.textContent = 'Opening your email app to finish sending the request…';
    }
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
  renderBundles(await loadBundles());
  wireQuoteForm();
});

/* ------------------------------------------------------------------
 * PACKING CHECKLIST POPUP
 *  - Slides in, checkboxes persist (localStorage), printable,
 *    paper SFX via Web Audio API, vertical action rail.
 * ------------------------------------------------------------------ */
const PACK_DATA = [
  { name: '📄 Paperwork & Pocket Cash', items: [
    'Passport (valid 6+ months past sail date)',
    'Photo ID (closed-loop sailings)',
    'Boarding pass / cruise e-docs',
    'Printed luggage tags',
    'Credit cards + modest cash',
    'Travel insurance details',
    'Health or vaccine paperwork (if required)',
    'Flight confirmations / parking pass'
  ]},
  { name: '🎒 Day-One Gear', items: [
    'Phone & charging cable',
    'Power bank',
    'Cruise-safe non-surge power strip',
    'Medications in original containers',
    'Reef-friendly sunscreen',
    'Aloe / after-sun care',
    'SPF lip balm',
    'Collapsible water bottle'
  ]},
  { name: '👕 Wardrobe', items: [
    'Underwear & socks',
    'Sleepwear',
    'Tees & polos',
    'Shorts / casual pants',
    'Swimwear (2+ sets)',
    'Cover-up / rash guard',
    'Evening outfit & dressy shoes',
    'Light jacket (cool ship A/C)'
  ]},
  { name: '👟 Footwear', items: [
    'Walking shoes / sneakers',
    'Flip-flops / pool slides',
    'Dress shoes',
    'Water shoes (rocky beaches)'
  ]},
  { name: '🧴 Fresh-Up Kit', items: [
    'Toothbrush, paste & floss',
    'Deodorant',
    'Brush & hair ties',
    'Travel shampoo / conditioner',
    'Face wash & moisturizer',
    'Makeup & remover',
    'Razor & shave cream',
    'Mini first-aid pouch'
  ]},
  { name: '🏖️ Port-Day Kit', items: [
    'Beach tote / daypack',
    'Quick-dry towel or towel clips',
    'Waterproof phone pouch',
    'Polarized sunglasses',
    'Sun hat / cap',
    'Snorkel set (optional)',
    'Bug spray (port days)'
  ]},
  { name: '🚪 Cabin Comforts', items: [
    'Strong magnetic hooks',
    'Over-door organizer (optional)',
    'USB night-light',
    'Fold-flat laundry bag',
    'Zip-top bags (wet suits / snacks)',
    'Highlighter for the daily planner',
    'Small fan (check line rules)'
  ]},
  { name: '💊 Feel-Good Kit', items: [
    'Seasickness bands / patches',
    'Non-drowsy motion remedy',
    'Electrolyte packets',
    'Hand sanitizer / wipes',
    'Pocket tissues'
  ]}
];

const PackList = (() => {
  const KEY = 'sunsetSail.packlist.v1';
  let audioCtx = null;

  const $ = (sel) => document.querySelector(sel);
  const panel   = () => $('#packPanel');
  const overlay = () => $('#packOverlay');

  /* --- Paper rustle SFX: filtered white-noise burst, no file needed --- */
  function playPaper() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const dur = 0.22;
      const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
      }
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const hp = audioCtx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2500;
      const vol = audioCtx.createGain();
      vol.gain.value = 0.12;
      src.connect(hp).connect(vol).connect(audioCtx.destination);
      src.start();
    } catch (_) { /* audio unsupported — stay silent */ }
  }

  function render() {
    const body = $('#packBody');
    body.innerHTML = PACK_DATA.map((cat, ci) => `
      <section class="pack-category">
        <h3>${escapeHtml(cat.name)}</h3>
        ${cat.items.map((item, ii) => `
          <div class="pack-item">
            <input type="checkbox" id="pk-${ci}-${ii}"
                   data-pack-item aria-describedby="pk-l-${ci}-${ii}">
            <label for="pk-${ci}-${ii}" id="pk-l-${ci}-${ii}">${escapeHtml(item)}</label>
          </div>`).join('')}
      </section>`).join('');

    body.addEventListener('change', onToggle);
    restore();
    updateProgress();
  }

  function onToggle(e) {
    if (!e.target.matches('[data-pack-item]')) return;
    const item = e.target.closest('.pack-item');
    item.classList.toggle('checked', e.target.checked);
    playPaper();
    persist();
    updateProgress();
  }

  function boxes() { return [...document.querySelectorAll('[data-pack-item]')]; }

function updateProgress() {
  const all = boxes(); // calls the outer boxes() helper
  const done = all.filter(b => b.checked).length;
  $('#packProgress').textContent =
    `${done} of ${all.length} packed` + (done === all.length && all.length ? ' — you\'re ready to sail! ⚓' : '');
}

  function persist() {
    const checked = boxes().filter(b => b.checked).map(b => b.id);
    try { localStorage.setItem(KEY, JSON.stringify(checked)); } catch (_) {}
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
      boxes().forEach(b => {
        if (saved.includes(b.id)) {
          b.checked = true;
          b.closest('.pack-item').classList.add('checked');
        }
      });
    } catch (_) {}
  }

  function open() {
    overlay().hidden = false;
    panel().hidden = false;
    requestAnimationFrame(() => {          // allow paint before transitioning
      overlay().classList.add('show');
      panel().classList.add('open');
    });
    panel().querySelector('.pack-btn').focus();
    $('#packTrigger').setAttribute('aria-expanded', 'true');
  }

  function close() {
    panel().classList.remove('open');
    overlay().classList.remove('show');
    setTimeout(() => { panel().hidden = true; overlay().hidden = true; }, 350);
    $('#packTrigger').setAttribute('aria-expanded', 'false');
    $('#packTrigger').focus();
  }

  function download() {
    const lines = [`CRUISE PACKING CHECKLIST — ${new Date().toLocaleDateString()}`, ''];
    PACK_DATA.forEach(cat => {
      lines.push(cat.name.toUpperCase());
      cat.items.forEach((item, i) => {
        const cb = document.getElementById(`pk-${PACK_DATA.indexOf(cat)}-${i}`);
        lines.push(`  [${cb && cb.checked ? 'x' : ' '}] ${item}`);
      });
      lines.push('');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'cruise-packing-checklist.txt'
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function wire() {
    $('#packTrigger').addEventListener('click', () =>
      panel().classList.contains('open') ? close() : open());

    panel().addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      switch (btn.dataset.action) {
        case 'print':     window.print(); break;
        case 'download':  download(); break;
        case 'selectAll': boxes().forEach(b => {
                            b.checked = true;
                            b.closest('.pack-item').classList.add('checked');
                          }); playPaper(); persist(); updateProgress(); break;
        case 'clear':     boxes().forEach(b => {
                            b.checked = false;
                            b.closest('.pack-item').classList.remove('checked');
                          }); persist(); updateProgress(); break;
        case 'close':     close(); break;
      }
    });

    overlay().addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel().classList.contains('open')) close();
    });
  }

  return { init() { render(); wire(); } };
})();

// Hook into the existing init flow
document.addEventListener('DOMContentLoaded', () => PackList.init());
