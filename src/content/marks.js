/* ============================================================================
   Registro de marcas: el JS de la Capa 2/3 SOLO escribe estos atributos; quien
   pinta es el CSS. Todas las marcas son idempotentes y reversibles, y se pueden
   borrar de golpe con resetCorrections().
   ============================================================================ */

export const MARK = Object.freeze({
  /* Estado del documento (siempre en <html>) */
  OFF: 'data-pbn-off',
  ENGINE: 'data-pbn-engine',
  STRICT: 'data-pbn-strict',
  MEASURING: 'data-pbn-measuring',
  KILLANIM: 'data-pbn-killanim',
  DIMMEDIA: 'data-pbn-dimmedia',
  ACCENT: 'data-pbn-accent',

  /* Correcciones de la Capa 2/3 */
  MEDIA: 'data-pbn-media', // fondo con foto → re-invertir
  FILTER: 'data-pbn-filterreset', // filtro del sitio que altera luminancia
  BLEND: 'data-pbn-blend', // mix-blend-mode dependiente del fondo
  BACKDROP: 'data-pbn-backdrop', // backdrop-filter
  FIX: 'data-pbn-fix', // texto invisible (estilo inline)
  FIX2: 'data-pbn-fix2', // texto oscuro fijado por clases CSS
  BG: 'data-pbn-bg', // bloque claro
  GRAD: 'data-pbn-grad', // texto con gradiente invisible
  SVG: 'data-pbn-svg', // icono SVG oscuro
  FLAT: 'data-pbn-flat', // sombras claras
  SHADOW: 'data-pbn-shadow' // host con shadow root creado tarde
});

/** Atributos que gobiernan el motor desde <html>. */
export const ROOT_ATTRS = Object.freeze([
  MARK.OFF,
  MARK.ENGINE,
  MARK.STRICT,
  MARK.MEASURING,
  MARK.KILLANIM,
  MARK.DIMMEDIA,
  MARK.ACCENT
]);

/** Atributos de corrección: se borran juntos al cambiar de motor o apagar. */
export const CORRECTION_ATTRS = Object.freeze([
  MARK.MEDIA,
  MARK.FILTER,
  MARK.BLEND,
  MARK.BACKDROP,
  MARK.FIX,
  MARK.FIX2,
  MARK.BG,
  MARK.GRAD,
  MARK.SVG,
  MARK.FLAT,
  MARK.SHADOW
]);

export const SELECTOR_CORRECCIONES = CORRECTION_ATTRS.map((attr) => `[${attr}]`).join(',');

export function mark(elemento, attr) {
  if (!elemento || typeof elemento.setAttribute !== 'function') return false;
  if (elemento.hasAttribute(attr)) return false;
  elemento.setAttribute(attr, '');
  return true;
}

export function unmark(elemento, attr) {
  if (!elemento || typeof elemento.removeAttribute !== 'function') return false;
  if (!elemento.hasAttribute(attr)) return false;
  elemento.removeAttribute(attr);
  return true;
}

export function hasMark(elemento, attr) {
  return Boolean(elemento) && typeof elemento.hasAttribute === 'function' && elemento.hasAttribute(attr);
}

/**
 * ¿El elemento tiene caja visible? `checkVisibility` existe desde Firefox 125 y
 * descarta nodos con display:none / content-visibility sin tocar el layout.
 */
export function isVisible(elemento) {
  if (!elemento) return false;
  if (typeof elemento.checkVisibility === 'function') {
    try {
      return elemento.checkVisibility() !== false;
    } catch {
      return true;
    }
  }
  return true;
}

/** Borra todas las marcas de corrección de un documento (una sola consulta). */
export function resetCorrections(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let borradas = 0;
  for (const elemento of root.querySelectorAll(SELECTOR_CORRECCIONES)) {
    for (const attr of CORRECTION_ATTRS) {
      if (elemento.removeAttribute(attr)) borradas += 1;
    }
  }
  return borradas;
}

/** Deja <html> limpio de estado del motor conservando la exclusión. */
export function clearRootState(root) {
  if (!root) return;
  for (const attr of ROOT_ATTRS) {
    if (attr === MARK.OFF) continue;
    root.removeAttribute(attr);
  }
}
