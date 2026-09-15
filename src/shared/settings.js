/* ============================================================================
   Estado y ajustes: ÚNICA fuente de verdad para background, content y popup.
   (Antes había tres copias divergentes de DEFAULTS/sanitize.)
   ============================================================================ */

import { error, mensajeDeError, warn } from './log.js';

export const DEFAULTS = Object.freeze({
  /** Interruptor global. */
  enabled: true,
  /** 'invert' = inversión con preservación de media · 'amoled' = selectores. */
  engine: 'invert',
  /** 'auto' mide una vez si el sitio ya es oscuro · 'on' aplica siempre. */
  mode: 'auto',
  /** AMOLED estricto: negro puro también en contenedores. */
  strict: true,
  /** Modo eco: apaga por completo la Capa 2 (solo CSS). */
  eco: false,
  killAnim: false,
  dimMedia: false,
  accent: 'multi',
  /** { hostname: true } */
  excluded: {}
});

export const ENGINES = Object.freeze(['invert', 'amoled']);
export const MODES = Object.freeze(['auto', 'on']);
export const ACCENTS = Object.freeze(['multi', 'green', 'cyan', 'magenta']);

const AREA_SYNC = 'sync';
const AREA_SESSION = 'session';
const CLAVE_PESTANA = 'tabOff';

function esObjetoPlano(valor) {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Normaliza cualquier entrada (storage, mensajes, UI) a un estado válido. */
export function sanitizeState(raw) {
  const fuente = esObjetoPlano(raw) ? raw : {};
  const estado = { ...DEFAULTS, ...fuente };

  const excluidos = {};
  if (esObjetoPlano(fuente.excluded)) {
    for (const [host, valor] of Object.entries(fuente.excluded)) {
      if (typeof host === 'string' && host.length > 0 && valor) excluidos[host] = true;
    }
  }
  estado.excluded = excluidos;

  estado.enabled = estado.enabled !== false;
  estado.strict = estado.strict !== false;
  estado.eco = estado.eco === true;
  estado.killAnim = estado.killAnim === true;
  estado.dimMedia = estado.dimMedia === true;
  if (!ENGINES.includes(estado.engine)) estado.engine = DEFAULTS.engine;
  if (!MODES.includes(estado.mode)) estado.mode = DEFAULTS.mode;
  if (!ACCENTS.includes(estado.accent)) estado.accent = DEFAULTS.accent;

  return estado;
}

function areaSync() {
  return browser.storage[AREA_SYNC] ?? browser.storage.local;
}

export async function loadState() {
  try {
    const crudo = await areaSync().get(DEFAULTS);
    return sanitizeState(crudo);
  } catch (err) {
    warn('no se pudo leer storage.sync, uso valores por defecto:', mensajeDeError(err));
    return sanitizeState(null);
  }
}

/**
 * Guarda el estado completo. No lanza: devuelve el resultado para que el popup
 * pueda avisar de cuota superada (storage.sync limita a 8 KB por entrada y la
 * lista de exclusiones crece con el usuario).
 */
export async function saveState(estado) {
  const limpio = sanitizeState(estado);
  try {
    await areaSync().set(limpio);
    return { ok: true, state: limpio };
  } catch (err) {
    error('no se pudo guardar el estado:', mensajeDeError(err));
    return { ok: false, state: limpio, error: err };
  }
}

export function onStateChanged(callback) {
  const objeto = browser.storage.onChanged;
  if (!objeto || typeof objeto.addListener !== 'function') return () => {};

  const listener = (changes, area) => {
    if (area !== AREA_SYNC && area !== 'local') return;
    if (!Object.keys(changes).length) return;
    try {
      callback();
    } catch (err) {
      error('fallo al reaccionar a storage.onChanged:', mensajeDeError(err));
    }
  };

  objeto.addListener(listener);
  return () => {
    try {
      objeto.removeListener(listener);
    } catch (err) {
      warn('no se pudo quitar el listener de storage:', mensajeDeError(err));
    }
  };
}

/* ---------------------------------------------------------------------------
   Override por pestaña (atajo Ctrl+Shift+L). Vive en storage.session: es
   efímero por diseño y los frames NUEVOS de una pestaña ya desactivada lo
   heredan, así que deja de haber estados inconsistentes dentro de la pestaña.
   --------------------------------------------------------------------------- */

function areaSession() {
  return browser.storage[AREA_SESSION] ?? null;
}

async function leerMapaPestanas() {
  const area = areaSession();
  if (!area) return {};
  try {
    const datos = await area.get(CLAVE_PESTANA);
    const mapa = datos?.[CLAVE_PESTANA];
    return esObjetoPlano(mapa) ? mapa : {};
  } catch (err) {
    warn('no se pudo leer el override por pestaña:', mensajeDeError(err));
    return {};
  }
}

async function escribirMapaPestanas(mapa) {
  const area = areaSession();
  if (!area) return false;
  try {
    await area.set({ [CLAVE_PESTANA]: mapa });
    return true;
  } catch (err) {
    error('no se pudo guardar el override por pestaña:', mensajeDeError(err));
    return false;
  }
}

export async function isTabOff(tabId) {
  if (tabId === undefined || tabId === null) return false;
  const mapa = await leerMapaPestanas();
  return mapa[tabId] === true;
}

/** Alterna el override de una pestaña y devuelve el nuevo valor (true = off). */
export async function toggleTabOff(tabId) {
  const mapa = await leerMapaPestanas();
  const nuevo = mapa[tabId] !== true;
  if (nuevo) mapa[tabId] = true;
  else delete mapa[tabId];
  await escribirMapaPestanas(mapa);
  return nuevo;
}

export async function clearTabOff(tabId) {
  const mapa = await leerMapaPestanas();
  if (mapa[tabId] === undefined) return false;
  delete mapa[tabId];
  await escribirMapaPestanas(mapa);
  return true;
}

export async function clearAllTabOff() {
  return escribirMapaPestanas({});
}

/* ---------------------------------------------------------------------------
   Utilidades de host
   --------------------------------------------------------------------------- */

export function hostOf(url) {
  try {
    return new URL(url).hostname || '';
  } catch {
    return '';
  }
}

/** Empaqueta el estado que necesita cualquier frame para pintar. */
export function frameFlags(estado, { host, tabOff, autoDark }) {
  const razon = !estado.enabled
    ? 'disabled'
    : estado.excluded[host] === true
      ? 'excluded'
      : tabOff
        ? 'tab'
        : autoDark
          ? 'auto-dark'
          : 'on';

  return {
    active: razon === 'on',
    reason: razon,
    engine: estado.engine,
    strict: estado.strict && razon === 'on',
    killAnim: estado.killAnim,
    dimMedia: estado.dimMedia,
    accent: estado.accent
  };
}
