/* ============================================================================
   Correcciones propias del MOTOR DE INVERSIÓN.

   Detecta los tres modos de fallo reales de invertir un documento:
     1. fondos con foto → [data-pbn-media] (se re-invierten y recuperan su color)
     2. filtros del sitio que alteran luminancia → [data-pbn-filterreset]
        (invertir un brightness/sepia ya aplicado da artefactos de color)
     3. mix-blend-mode / backdrop-filter dependientes del fondo →
        [data-pbn-blend] y [data-pbn-backdrop]

   Sin lectura de geometría: la decisión de "esto es una foto de fondo
   deliberada" se toma con `background-size` (cover / contain / medida
   explícita), que es gratis, y no con getBoundingClientRect.
   ============================================================================ */

import { MARK, hasMark, mark } from '../marks.js';

const RE_URL = /url\(/i;
const RE_FILTRO_COLOR = /\b(?:invert|brightness|contrast|grayscale|sepia|hue-rotate|saturate)\s*\(/i;

const ETIQUETAS_MEDIA = new Set([
  'IMG',
  'VIDEO',
  'CANVAS',
  'IFRAME',
  'EMBED',
  'OBJECT',
  'PICTURE',
  'AUDIO',
  'SOURCE',
  'TRACK',
  'SVG',
  'MAP',
  'AREA'
]);

export function isMediaTag(el) {
  return ETIQUETAS_MEDIA.has(el.tagName);
}

/**
 * @param {Element} el
 * @param {() => CSSStyleDeclaration | null} leerEstilos getter perezoso: asegura
 *        UNA sola llamada a getComputedStyle por nodo aunque haya 4 comprobaciones.
 */
export function checkInvertPass(el, leerEstilos) {
  const tag = el.tagName;
  // Re-invertir <html> o <body> cancelaría (o alteraría) la página entera.
  if (tag === 'HTML' || tag === 'BODY') return false;

  const estilos = leerEstilos();
  if (!estilos) return false;

  let corregido = false;
  const imagenFondo = String(estilos.backgroundImage ?? 'none');

  // 1. Fondo con foto.
  if (!hasMark(el, MARK.MEDIA) && !isMediaTag(el) && imagenFondo !== 'none' && RE_URL.test(imagenFondo)) {
    const tamano = String(estilos.backgroundSize ?? 'auto');
    if (tamano !== 'auto') corregido = mark(el, MARK.MEDIA) || corregido;
  }

  // Elementos que nuestra propia hoja ya re-invierte: su `filter` computado es
  // el nuestro, así que no sirven para juzgar el del sitio.
  const yaReinvertido = isMediaTag(el) || hasMark(el, MARK.MEDIA) ||
    (imagenFondo !== 'none' && RE_URL.test(imagenFondo));

  // 2. Filtro del sitio que altera luminancia.
  if (!yaReinvertido) {
    const filtro = String(estilos.filter ?? 'none');
    if (filtro !== 'none' && RE_FILTRO_COLOR.test(filtro) && !hasMark(el, MARK.FILTER)) {
      corregido = mark(el, MARK.FILTER) || corregido;
    }
  }

  // 3. Modos de mezcla dependientes del color del fondo.
  const mezcla = String(estilos.mixBlendMode ?? 'normal');
  if (mezcla !== 'normal' && !hasMark(el, MARK.BLEND)) corregido = mark(el, MARK.BLEND) || corregido;

  // 4. Desenfoque del fondo (glassmorphism) que al invertir queda turbio.
  const desenfoque = String(estilos.backdropFilter ?? 'none');
  if (desenfoque !== 'none' && !hasMark(el, MARK.BACKDROP)) corregido = mark(el, MARK.BACKDROP) || corregido;

  return corregido;
}
