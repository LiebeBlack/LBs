/* ============================================================================
   Pase B — recorrido con estilos computados, en rebanadas.

   Cada nodo cuesta exactamente UNA llamada a getComputedStyle (getter perezoso
   compartido) y el recorrido cede el control después de cada nodo, así que el
   gobernador puede cortar por tiempo en cualquier punto y reanudar más tarde.

   Presupuesto de nodos por tarea (no por página): las páginas dinámicas se
   re-escanean cuando llegan mutaciones, y el techo de CPU acumulada lo pone el
   gobernador, no un contador que dejaría la página congelada tras agotarse.
   ============================================================================ */

import { dressShadowRootsOf } from '../shadow.js';
import { MARK, hasMark, isVisible } from '../marks.js';
import { analizarEstiloInline } from './cheap.js';
import { checkAmoledPass } from './amoled.js';
import { checkInvertPass } from './media.js';

const NS_SVG = 'http://www.w3.org/2000/svg';

/** Subárboles sin nada que corregir (y donde el análisis sería caro e inútil). */
const ETIQUETAS_IGNORADAS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'OPTGROUP',
  'AUDIO',
  'VIDEO',
  'CANVAS',
  'IFRAME',
  'EMBED',
  'OBJECT',
  'IMG',
  'PICTURE',
  'SOURCE',
  'TRACK',
  'MAP',
  'AREA',
  'LINK',
  'META',
  'TITLE',
  'BASE'
]);

function aceptarNodo(nodo) {
  if (ETIQUETAS_IGNORADAS.has(nodo.tagName)) return NodeFilter.FILTER_REJECT;
  // Dentro de un <svg> no hay nada que corregir: solo interesa el propio icono.
  if (nodo.namespaceURI === NS_SVG && nodo.tagName !== 'svg') return NodeFilter.FILTER_REJECT;
  return NodeFilter.FILTER_ACCEPT;
}

/** Analiza un nodo con todos los pases. Devuelve true si añadió alguna marca. */
function procesarNodo(el, ctx) {
  let corregido = analizarEstiloInline(el, ctx);

  if (ctx.engine === 'amoled' && dressShadowRootsOf(el)) corregido = true;

  // Los nodos sin caja visible no aportan nada y ahorran su getComputedStyle.
  if (!isVisible(el)) return corregido;

  let estilos = null;
  const leerEstilos = () => {
    if (estilos === null) {
      try {
        estilos = getComputedStyle(el);
      } catch {
        estilos = null;
      }
    }
    return estilos;
  };

  const marcado = ctx.engine === 'invert' ? checkInvertPass(el, leerEstilos) : checkAmoledPass(el, leerEstilos);
  return marcado || corregido;
}

function* recorrer(root, ctx) {
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode: aceptarNodo });
  let bloquePreservado = null;

  while (walker.nextNode()) {
    const el = walker.currentNode;

    ctx.presupuesto.visitados += 1;
    if (ctx.presupuesto.visitados > ctx.presupuesto.max) return;

    yield; // punto de cesión: aquí corta y reanuda el gobernador

    if (bloquePreservado) {
      if (bloquePreservado.contains(el)) continue;
      bloquePreservado = null;
    }

    if (procesarNodo(el, ctx) && ctx.engine === 'invert' && hasMark(el, MARK.MEDIA)) {
      // Dentro de un bloque ya re-invertido no se marca nada más: las
      // correcciones anidadas se cancelarían entre sí.
      bloquePreservado = el;
    }
  }
}

/** Barrido completo del documento (una tarea acotada por presupuesto). */
export function* sweepPass(root, ctx) {
  const objetivo = root ?? (typeof document !== 'undefined' ? document.body ?? document.documentElement : null);
  if (!objetivo) return;
  yield* recorrer(objetivo, ctx);
}

/** Lote de mutaciones: nodos nuevos o con estilo/clase cambiados. */
export function* batchPass(nodos, ctx) {
  for (const nodo of nodos) {
    if (!nodo || nodo.nodeType !== 1 || !nodo.isConnected) continue;
    if (ctx.presupuesto.visitados > ctx.presupuesto.max) return;

    ctx.presupuesto.visitados += 1;
    yield;

    const marcado = procesarNodo(nodo, ctx);
    if (marcado && ctx.engine === 'invert' && hasMark(nodo, MARK.MEDIA)) continue;
    if (nodo.childElementCount > 0) yield* recorrer(nodo, ctx);
  }
}
