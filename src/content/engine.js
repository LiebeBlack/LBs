/* ============================================================================
   Aplicación del estado al elemento raíz. Es la frontera entre el JS y el CSS:
   aquí no se decide nada visual, solo se escriben los atributos que las hojas
   de la Capa 1 ya saben interpretar.
   ============================================================================ */

import { MARK, unmark } from './marks.js';

/**
 * Atributos por defecto, escritos de forma SÍNCRONA en document_start (antes de
 * cualquier await): el motor de inversión queda activo en el primer pintado sin
 * esperar a storage. Si el usuario tiene otras preferencias, se reconcilian en
 * cuanto llega el estado real.
 */
export function armDefaults(root) {
  if (!root) return;
  root.setAttribute(MARK.ENGINE, 'invert');
  root.setAttribute(MARK.STRICT, '');
  root.setAttribute(MARK.MEASURING, '');
}

/** Aplica el resultado de frameFlags(). Nunca escribe marcas si va apagado. */
export function applyFlags(root, flags) {
  if (!root || !flags) return;

  root.setAttribute(MARK.ENGINE, flags.engine);
  if (flags.active) unmark(root, MARK.OFF);
  else root.setAttribute(MARK.OFF, '');

  root.toggleAttribute(MARK.STRICT, flags.strict === true);
  root.toggleAttribute(MARK.KILLANIM, flags.killAnim === true);
  root.toggleAttribute(MARK.DIMMEDIA, flags.dimMedia === true);

  if (flags.accent && flags.accent !== 'multi') root.setAttribute(MARK.ACCENT, flags.accent);
  else unmark(root, MARK.ACCENT);
}

export function setMeasuring(root, activo) {
  if (!root) return;
  root.toggleAttribute(MARK.MEASURING, activo === true);
}
