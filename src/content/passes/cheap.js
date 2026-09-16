/* ============================================================================
   Pase A — barato: solo mira el ATRIBUTO `style` de los nodos.

   No llama a getComputedStyle ni lee geometría, así que no fuerza estilo ni
   layout. Sirve para pillar lo que los sitios escriben en línea, que es donde
   están los casos más visibles (texto casi negro, bloques blancos, fotos de
   fondo).

   El valor declarado en línea es, por definición, del sitio: no hay heurística
   de herencia que aplicar aquí.
   ============================================================================ */

import { luminance, toRgb } from '../../shared/color.js';
import { MARK, hasMark, mark, unmark } from '../marks.js';

const LIMITE_ATRIBUTO = 8000; // por encima, el atributo no es un estilo: es basura
const RE_URL = /url\s*\(/i;
const RE_GRADIENTE = /^(?:-\w+-)?(?:linear|radial|conic)-gradient\s*\(/i;
/** Tamaño explícito en una declaración `background-size` suelta (no `auto`). */
const RE_TAMANO_EXPLICITO = /(?:^|[\s,])(?:cover|contain|\d+(?:\.\d+)?(?:%|[a-z]+))/i;
const UMBRAL_TEXTO_INVISIBLE = 0.09;
const UMBRAL_FONDO_CLARO = 0.32;

function analizarDeclaracion(propiedad, valor, el, engine, tieneUrl) {
  if (propiedad === 'background' || propiedad === 'background-image' || propiedad === 'background-color' || propiedad === 'background-size') {
    // Un fondo con foto sin rescate se vería en negativo (invert) o desaparecería
    // aplastado a negro (amoled). Hay URL en esta declaración, o la hay en otra
    // del mismo atributo junto con un tamaño explícito (p. ej. `background-image`
    // + `background-size: cover` en declaraciones separadas). Re-invertir un
    // sprite es inocuo: el icono recupera sus colores originales.
    const conUrl = RE_URL.test(valor) ||
      (tieneUrl && propiedad === 'background-size' && RE_TAMANO_EXPLICITO.test(valor));
    if (conUrl) {
      // La foto manda, sea cual sea el orden de las declaraciones: si el mismo
      // atributo ya marcó un bloque claro, esa marca se retira (un elemento con
      // foto no es un bloque de texto plano).
      if (!hasMark(el, MARK.MEDIA)) {
        unmark(el, MARK.BG);
        return mark(el, MARK.MEDIA); // ambos motores preservan la foto
      }
      return false;
    }
    if (engine === 'invert') return false; // [data-pbn-bg] solo pinta en AMOLED
    if (hasMark(el, MARK.BG) || hasMark(el, MARK.MEDIA) || valor === 'transparent' || RE_URL.test(valor)) return false;
    if (RE_GRADIENTE.test(valor)) return mark(el, MARK.BG);
    const fondo = toRgb(valor);
    if (fondo && fondo.a >= 0.35 && luminance(fondo) > UMBRAL_FONDO_CLARO) return mark(el, MARK.BG);
    return false;
  }

  if (engine !== 'amoled') return false;

  if (propiedad === 'color' || propiedad === '-webkit-text-fill-color') {
    if (hasMark(el, MARK.FIX)) return false;
    const color = toRgb(valor);
    if (color && color.a * luminance(color) < UMBRAL_TEXTO_INVISIBLE) return mark(el, MARK.FIX);
  }
  return false;
}

/** Analiza el estilo en línea de un nodo y aplica las marcas que correspondan. */
export function analizarEstiloInline(el, ctx) {
  if (!el || typeof el.getAttribute !== 'function') return false;
  const estilo = el.getAttribute('style');
  if (!estilo || estilo.length > LIMITE_ATRIBUTO) return false;

  let corregido = false;
  const tieneUrl = RE_URL.test(estilo); // la URL puede estar en otra declaración
  for (const declaracion of estilo.split(';')) {
    const corte = declaracion.indexOf(':');
    if (corte <= 0) continue;
    const propiedad = declaracion.slice(0, corte).trim().toLowerCase();
    const valor = declaracion.slice(corte + 1).trim();
    if (!valor || valor.startsWith('var(')) continue;
    if (analizarDeclaracion(propiedad, valor, el, ctx.engine, tieneUrl)) corregido = true;
  }
  return corregido;
}
