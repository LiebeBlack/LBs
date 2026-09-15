/* ============================================================
   Pure Black Neon v2.0 — background.js (no persistente, mínimo)
   - Badge ON/OFF en el icono según el sitio
   - Atajo Ctrl+Shift+L: alterna el modo SOLO en la pestaña activa
   La sincronización de ajustes la hace storage.onChanged en cada
   content script; el popup escribe en storage.sync directamente.
   ============================================================ */
'use strict';

const DEFAULTS = { enabled: true, mode: 'auto', accent: 'multi', excluded: {} };

function sanitize(state) {
  if (typeof state.excluded !== 'object' || state.excluded === null || Array.isArray(state.excluded)) {
    state.excluded = {};
  }
  return state;
}

async function getState() {
  try {
    return sanitize(await browser.storage.sync.get(DEFAULTS));
  } catch (_) {
    return { ...DEFAULTS, excluded: {} };
  }
}

async function updateBadge(tabId, url) {
  const state = await getState();
  let host = '';
  try { host = new URL(url).hostname || ''; } catch (_) { /* páginas internas */ }

  const on = state.enabled && !state.excluded[host] && host !== '';
  try {
    await browser.action.setBadgeText({ tabId, text: on ? '' : 'OFF' });
    if (!on) await browser.action.setBadgeBackgroundColor({ tabId, color: '#ff2bd6' });
  } catch (_) { /* pestaña ya cerrada */ }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab && tab.url) updateBadge(tabId, tab.url);
});

/* Ctrl+Shift+L → alternar en la pestaña actual */
browser.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-dark') return;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return;
    await browser.tabs.sendMessage(tab.id, { type: 'pbn:toggle-tab' });
    if (tab.url) updateBadge(tab.id, tab.url);
  } catch (_) { /* sin content script en esa página: ignorar en silencio */ }
});
