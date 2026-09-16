/* ============================================================================
   Correcciones propias del MOTOR AMOLED (por selectores).

   Aquí sí hay fallos de color que la hoja no puede adivinar, porque dependen
   de lo que el sitio declare por clases CSS:
     · texto oscuro sobre el negro que acabamos de imponer → [data-pbn-fix2]
     · texto recortado sobre un gradiente (background-clip:text) → [data-pbn-grad]
     · bloques claros → [data-pbn-bg]
     · iconos SVG con relleno oscuro explícito → [data-pbn-svg]
     · sombras claras que en negro son halos → [data-pbn-flat]

   La heurística de "color propio" es real: compara el color computado con el
   del padre en lugar de consultar una variable que nunca existió (el antiguo
   --pbn-owner) ni de fiarse del croma.
   ============================================================================ */

import { chroma, luminance, luminanceOverBlack, toRgb } from '../../shared/color.js';
import { MARK, hasMark, mark, unmark } from '../marks.js';
import { isMediaTag } from './media.js';

const NS_SVG = 'http://www.w3.org/2000/svg';
const UMBRAL_TEXTO_INVISIBLE = 0.09;
const UMBRAL_FONDO_CLARO = 0.32;
const UMBRAL_CROMA_NEUTRO = 10;
const UMBRAL_SOMBRA_CLARA = 0.5;
/** Primera pieza de un box-shadow: su color (o su longitud, que descartamos). */
const RE_INICIO_SOMBRA = /^(?:[a-z-]+\([^)]*\)|#[0-9a-f]{3,8}|\w+)/i;
const RE_URL_FONDO = /url\(/i;

/** Color computado del último análisis de cada nodo: `estaHeredado` lo consulta
 *  en lugar de volver a llamar a getComputedStyle sobre el padre (1 lectura/nodo). */
const COLOR_DEL_NODO = new WeakMap();

function estaHeredado(el, colorComputado) {
  const padre = el.parentElement;
  if (!padre) return false;
  const delPadre = COLOR_DEL_NODO.get(padre);
  if (delPadre !== undefined) return delPadre === colorComputado;
  try {
    return getComputedStyle(padre).color === colorComputado;
  } catch {
    return false;
  }
}

export function checkAmoledPass(el, leerEstilos) {
  const estilos = leerEstilos();
  if (!estilos) return false;
  COLOR_DEL_NODO.set(el, String(estilos.color));

  const esSvgRaiz = el.namespaceURI === NS_SVG && el.tagName === 'svg';
  if (!esSvgRaiz && isMediaTag(el)) return false; // la media nunca se toca

  let corregido = false;

  /* --- Icono SVG: relleno oscuro explícito (con currentColor manda la cascada). */
  if (esSvgRaiz) {
    if (hasMark(el, MARK.SVG)) return false;
    const relleno = String(estilos.fill ?? 'none');
    if (relleno !== 'none' && relleno !== 'currentColor') {
      const color = toRgb(relleno);
      if (color && color.a > 0.5 && luminance(color) < 0.2) return mark(el, MARK.SVG);
    }
    return false;
  }

  /* --- Texto con gradiente recortado al texto: sobre negro sería invisible. */
  const imagenFondo = String(estilos.backgroundImage ?? 'none');
  if (!hasMark(el, MARK.GRAD)) {
    const recorta = String(estilos.backgroundClip ?? '').toLowerCase();
    if (imagenFondo !== 'none' && recorta.includes('text')) corregido = mark(el, MARK.GRAD) || corregido;
  }

  /* --- Fondo con foto (héroe, banner, tarjeta con imagen): en AMOLED también
         es media y se preserva; sin marca, el CSS lo aplastaría a negro y el
         elemento desaparecería. El tamaño explícito descarta patrones diminutos. */
  if (!hasMark(el, MARK.MEDIA) && imagenFondo !== 'none' && RE_URL_FONDO.test(imagenFondo)) {
    const tamano = String(estilos.backgroundSize ?? 'auto');
    if (tamano !== 'auto') {
      // La foto manda: retira un [data-pbn-bg] previo del mismo elemento.
      unmark(el, MARK.BG);
      corregido = mark(el, MARK.MEDIA) || corregido;
    }
  }

  /* --- Bloque claro: se lleva a negro puro (nunca sobre una foto: la regla
         [data-pbn-bg] hace background-image:none y borraría la imagen). */
  if (!hasMark(el, MARK.BG) && !hasMark(el, MARK.MEDIA)) {
    const fondo = toRgb(estilos.backgroundColor);
    if (fondo && fondo.a >= 0.35 && luminance(fondo) > UMBRAL_FONDO_CLARO) {
      corregido = mark(el, MARK.BG) || corregido;
    }
  }

  /* --- Texto que quedaría invisible: solo si el sitio lo declara. */
  if (!hasMark(el, MARK.FIX2)) {
    const color = toRgb(estilos.color);
    if (color && luminanceOverBlack(color) < UMBRAL_TEXTO_INVISIBLE) {
      const neutroOpaco = color.a >= 0.99 && chroma(color) < UMBRAL_CROMA_NEUTRO;
      // Heredado + neutro opaco ya lo arregla la cascada base: marcarlo sería ruido.
      if (!neutroOpaco || !estaHeredado(el, estilos.color)) corregido = mark(el, MARK.FIX2) || corregido;
    }
  }

  /* --- Sombras claras: en negro son anillos blancos. */
  if (!hasMark(el, MARK.FLAT)) {
    const sombra = String(estilos.boxShadow ?? 'none');
    if (sombra !== 'none') {
      const inicio = RE_INICIO_SOMBRA.exec(sombra);
      const color = inicio ? toRgb(inicio[0]) : null;
      if (color && color.a > 0.05 && luminance(color) > UMBRAL_SOMBRA_CLARA) {
        corregido = mark(el, MARK.FLAT) || corregido;
      }
    }
  }

  return corregido;
}
