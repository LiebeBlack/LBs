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
import { MARK, hasMark, mark } from '../marks.js';

const LIMITE_ATRIBUTO = 8000; // por encima, el atributo no es un estilo: es basura
const RE_URL = /url\s*\(/i;
const RE_GRADIENTE = /^(?:-\w+-)?(?:linear|radial|conic)-gradient\s*\(/i;
const UMBRAL_TEXTO_INVISIBLE = 0.09;
const UMBRAL_FONDO_CLARO = 0.32;

function analizarDeclaracion(propiedad, valor, el, engine) {
  if (propiedad === 'background' || propiedad === 'background-image' || propiedad === 'background-color') {
    if (engine === 'invert') {
      // Un fondo con foto sin rescate se vería en negativo.
      if (!RE_URL.test(valor) || hasMark(el, MARK.MEDIA)) return false;
      return mark(el, MARK.MEDIA);
    }
    if (hasMark(el, MARK.BG) || valor === 'transparent' || RE_URL.test(valor)) return false;
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
  for (const declaracion of estilo.split(';')) {
    const corte = declaracion.indexOf(':');
    if (corte <= 0) continue;
    const propiedad = declaracion.slice(0, corte).trim().toLowerCase();
    const valor = declaracion.slice(corte + 1).trim();
    if (!valor || valor.startsWith('var(')) continue;
    if (analizarDeclaracion(propiedad, valor, el, ctx.engine)) corregido = true;
  }
  return corregido;
}
