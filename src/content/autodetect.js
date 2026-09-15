/* ============================================================================
   Modo Auto: UNA medición, sin analizar el DOM.

   Presupuesto duro: 3 llamadas a getComputedStyle en el caso peor (html, body
   y primer contenedor) y ninguna más; el tope absoluto del objeto es 4, aunque
   nunca se alcanza porque la lectura de <html> se reutiliza entre fases. No hay
   recorridos de árbol, ni observers, ni re-sondeos en cascada.

   Fase A (document_start): fondo real de <html> (y su color-scheme declarado).
   Si es opaco ya decide. La lectura se guarda para no repetirla.
   Fase B (cuando existe <body>): si <html> era transparente, se compone el
   fondo de <body> y, si también es transparente, el del primer contenedor
   (#app), que es donde las SPA oscuras pintan el fondo de verdad.

   Se mide el color REAL del sitio: por eso el motor de inversión no fuerza el
   fondo de html/body (el lienzo negro lo garantiza un respaldo ::before que no
   altera ningún estilo computado).
   ============================================================================ */

import { luminance, luminanceOverWhite, releaseColorContext, toRgb } from '../shared/color.js';
import { debug, mensajeDeError, warn } from '../shared/log.js';

/** Por debajo de esta luminancia el sitio ya es oscuro: no lo tocamos. */
const UMBRAL_OSCURO = 0.12;
/** Por encima de esto es claramente claro: se decide al instante. */
const UMBRAL_CLARO = 0.32;
/** Tope absoluto de mediciones por página. */
const MAX_LLAMADAS = 4;

export function createAutoDetector() {
  let resultado = null; // null = indeciso ('dark' | 'light')
  let llamadas = 0;
  let contextoLiberado = false;
  let lecturaHtml = null; // se guarda de la fase A para no repetir la medición

  function leerFondo(elemento) {
    if (!elemento || llamadas >= MAX_LLAMADAS) return null;
    try {
      llamadas += 1;
      const estilos = getComputedStyle(elemento);
      return {
        color: toRgb(estilos.backgroundColor),
        declaraOscuro: String(estilos.colorScheme ?? '').toLowerCase().includes('dark')
      };
    } catch (err) {
      warn('no se pudo medir el fondo del documento:', mensajeDeError(err));
      return null;
    }
  }

  function cerrar(decision) {
    resultado = decision;
    if (!contextoLiberado) {
      contextoLiberado = true;
      releaseColorContext(); // el contexto 2D ya no hace falta: fuera de memoria
    }
    debug('auto:', decision, `(${llamadas} mediciones)`);
    return decision;
  }

  /**
   * Devuelve 'dark', 'light' o null mientras siga indeciso. Llamarla de nuevo
   * cuando aparezca <body> completa la fase B.
   */
  function measure() {
    if (resultado !== null) return resultado;
    if (typeof document === 'undefined' || !document.documentElement) return null;

    if (lecturaHtml === null) lecturaHtml = leerFondo(document.documentElement);
    const html = lecturaHtml;
    if (!html || !html.color) return null; // documento no medible: el motor sigue activo

    const alfaHtml = html.color.a;
    const lumHtml = luminance(html.color);

    if (alfaHtml >= 0.9) {
      // Fondo opaco: decisión inmediata, sin esperar a <body>.
      if (lumHtml <= UMBRAL_OSCURO) return cerrar('dark');
      if (lumHtml >= UMBRAL_CLARO) return cerrar('light');
      return cerrar(html.declaraOscuro ? 'dark' : 'light');
    }

    if (alfaHtml > 0.05 && lumHtml <= UMBRAL_OSCURO) return cerrar('dark');
    if (html.declaraOscuro && luminanceOverWhite(html.color) < UMBRAL_CLARO) return cerrar('dark');

    // <html> transparente: hace falta <body> para decidir con datos reales.
    const body = leerFondo(document.body);
    if (!body) return null;

    const lienzo = html.declaraOscuro ? 0 : 1;
    let luminancia;
    if (!body.color || body.color.a <= 0.05) {
      // El patrón más común de las SPA oscuras: html y body transparentes y el
      // fondo real en el primer contenedor (#app). Una lectura más y se decide.
      const wrapper = leerFondo(document.body.firstElementChild);
      if (!wrapper || !wrapper.color || wrapper.color.a <= 0.05) {
        return cerrar(html.declaraOscuro ? 'dark' : 'light');
      }
      luminancia = wrapper.color.a * luminance(wrapper.color) + (1 - wrapper.color.a) * lienzo;
    } else {
      luminancia = alfaHtml > 0.05
        ? body.color.a * luminance(body.color) + (1 - body.color.a) * lumHtml
        : luminanceOverWhite(body.color);
    }

    return cerrar(luminancia <= UMBRAL_OSCURO ? 'dark' : 'light');
  }

  return {
    measure,
    reset() {
      resultado = null;
      llamadas = 0;
      lecturaHtml = null;
    }
  };
}
