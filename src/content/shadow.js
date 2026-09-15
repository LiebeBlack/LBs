/* ============================================================================
   Shadow DOM (solo motor AMOLED; la inversión atraviesa el shadow DOM por sí
   sola, así que en ese motor no hay nada que hacer aquí).

   · Una ÚNICA hoja construida y compartida por todas las raíces mediante
     adoptedStyleSheets: un solo objeto en memoria en lugar de un <style> por
     raíz.
   · El puente con el mundo de la página es un ATRIBUTO (data-pbn-shadow) que
     hook-main.js escribe al crear la raíz: los atributos cruzan mundos, las
     propiedades expando no (Xray vision).

   NOTA: el texto de esta hoja duplica a propósito los acentos de amoled.css.
   No es un descuido: el CSS de un shadow root no lo puede alcanzar ninguna
   hoja del documento (frontera de encapsulación), y el content script no puede
   leer archivos del paquete sin una petición extra. Si tocas los acentos, toca
   los dos sitios.
   ============================================================================ */

import { mensajeDeError, warn } from '../shared/log.js';
import { MARK, hasMark, unmark } from './marks.js';

const SHADOW_CSS = `
  :host { background-color: #000 !important; color: var(--pbn-fg, #e8eef4) !important; color-scheme: dark; }
  :host(:not(svg)) * { color: inherit; }
  :host a { color: var(--pbn-accent2, #00e5ff) !important; }
  :host h1, :host h2, :host h3, :host h4, :host h5, :host h6 { color: var(--pbn-fg-hi, #ffffff) !important; }
  :host input, :host textarea, :host select, :host button {
    background: var(--pbn-input, #0d1117) !important;
    color: inherit !important;
    border-color: var(--pbn-line, #30363d) !important;
  }
  :host img, :host video, :host canvas, :host svg { filter: none; background: transparent; }
  ::selection { background: var(--pbn-accent3, #ff2bd6) !important; color: #000 !important; }
  :focus-visible { outline: 2px solid var(--pbn-accent, #00ff9c) !important; outline-offset: 1px; }
  [data-pbn-fix] { color: var(--pbn-fg-hi, #ffffff) !important; }
  [data-pbn-fix2] { color: var(--pbn-fg, #e8eef4) !important; }
  [data-pbn-bg] { background-color: #000 !important; background-image: none !important; }
  [data-pbn-svg] { fill: var(--pbn-accent2, #00e5ff) !important; stroke: var(--pbn-accent2, #00e5ff) !important; }
`;

let hojaCompartida = null;
let hojaIntentada = false;
const raicesVestidas = new WeakSet();

function obtenerHoja() {
  if (hojaIntentada) return hojaCompartida;
  hojaIntentada = true;
  if (typeof CSSStyleSheet !== 'function') return null;
  try {
    hojaCompartida = new CSSStyleSheet();
    hojaCompartida.replaceSync(SHADOW_CSS);
  } catch (err) {
    warn('no se pudo construir la hoja del shadow DOM:', mensajeDeError(err));
    hojaCompartida = null;
  }
  return hojaCompartida;
}

/** Viste una raíz abierta. Idempotente y a prueba de raíces detachadas. */
export function dressShadowRoot(root) {
  if (!root || raicesVestidas.has(root)) return false;
  raicesVestidas.add(root);
  try {
    const hoja = obtenerHoja();
    if (hoja) {
      const actuales = root.adoptedStyleSheets ?? [];
      if (!actuales.includes(hoja)) root.adoptedStyleSheets = [...actuales, hoja];
      return true;
    }
    const estilo = document.createElement('style');
    estilo.textContent = SHADOW_CSS;
    root.prepend(estilo);
    return true;
  } catch (err) {
    warn('no se pudo vestir una shadow root:', mensajeDeError(err));
    return false;
  }
}

/**
 * Vestido perezoso desde el barrido: raíces ya presentes y hosts marcados por
 * hook-main.js (raíces creadas después de nuestro último escaneo).
 */
export function dressShadowRootsOf(elemento) {
  if (!elemento) return false;
  let vestida = false;
  const marcado = hasMark(elemento, MARK.SHADOW);

  const root = elemento.shadowRoot;
  if (root) vestida = dressShadowRoot(root) || vestida;
  if (marcado) {
    if (root) vestida = dressShadowRoot(root) || vestida;
    unmark(elemento, MARK.SHADOW); // la marca ya cumplió su función
  }
  return vestida;
}
