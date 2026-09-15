/* ============================================================
   Pure Black Neon v2.2 — popup.js
   Carga/guarda ajustes en storage.sync; los content scripts
   reaccionan solos vía storage.onChanged (sin mensajes extra).
   ============================================================ */
'use strict';

const DEFAULTS = { enabled: true, mode: 'auto', accent: 'multi', killAnim: false, dimMedia: false, excluded: {} };

const $ = id => document.getElementById(id);
const enabledEl = $('enabled');
const modeEl = $('mode');
const accentEl = $('accent');
const killAnimEl = $('kill-anim');
const dimMediaEl = $('dim-media');
const excludeEl = $('exclude');
const hostEl = $('host');

let state = { ...DEFAULTS };
let host = '';

/* ---------- helpers ---------- */

function markSegmented(container, value) {
  for (const btn of container.querySelectorAll('button')) {
    btn.setAttribute('aria-checked', String(btn.dataset.value === value));
  }
}

async function save() {
  try { await browser.storage.sync.set(state); } catch (_) { /* sync lleno o no disponible */ }
}

function currentHost() {
  return new Promise(resolve => {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      try { resolve(new URL(tab.url).hostname || ''); } catch (_) { resolve(''); }
    }).catch(() => resolve(''));
  });
}

/* ---------- render ---------- */

function render() {
  const siteOn = !!state.enabled && !state.excluded[host];
  enabledEl.checked = siteOn;
  markSegmented(modeEl, state.mode);
  markSegmented(accentEl, state.accent);
  killAnimEl.checked = !!state.killAnim;
  dimMediaEl.checked = !!state.dimMedia;
  const excluded = !!state.excluded[host];
  hostEl.textContent = host ? (excluded ? 'OFF · ' + host : 'ON · ' + host) : '—';
  excludeEl.textContent = excluded ? 'Incluir este sitio' : 'Excluir este sitio';
  document.body.classList.toggle('disabled', !siteOn);
}

/* ---------- eventos ---------- */

enabledEl.addEventListener('change', () => {
  state.enabled = enabledEl.checked;
  if (state.enabled && host && state.excluded[host]) delete state.excluded[host];  // encender libera la exclusión
  save().then(render);
});

for (const container of [modeEl, accentEl]) {
  container.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const key = container === modeEl ? 'mode' : 'accent';
    state[key] = btn.dataset.value;
    markSegmented(container, state[key]);
    save();
  });
}

killAnimEl.addEventListener('change', () => {
  state.killAnim = killAnimEl.checked;
  save();
});

dimMediaEl.addEventListener('change', () => {
  state.dimMedia = dimMediaEl.checked;
  save();
});

excludeEl.addEventListener('click', () => {
  if (!host) return;
  if (state.excluded[host]) delete state.excluded[host];
  else state.excluded[host] = true;
  save().then(render);
});

/* ---------- init ---------- */

(async () => {
  try {
    const stored = await browser.storage.sync.get(DEFAULTS);
    state = {
      ...DEFAULTS,
      ...stored,
      excluded: (stored.excluded && typeof stored.excluded === 'object') ? stored.excluded : {}
    };
    state.killAnim = !!state.killAnim;
    state.dimMedia = !!state.dimMedia;
  } catch (_) { /* defaults */ }
  host = await currentHost();
  render();
})();
