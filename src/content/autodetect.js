/* ============================================================================
   Modo Auto: UNA medición, sin analizar el DOM.

   Presupuesto duro: como máximo 2 llamadas a getComputedStyle por fase y 2
   fases en toda la vida de la página (4 llamadas en total, ~microsegundos). No
   hay recorridos de árbol, ni observers, ni re-sondeos en cascada.

   Fase A (document_start): fondo real de <html>. Si es opaco ya decide.
   Fase B (cuando existe <body>): si <html> era transparente, se compone el
   fondo de <body> sobre el lienzo y se decide con datos reales.

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

    const html = leerFondo(document.documentElement);
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
    if (!body.color) {
      // Sin fondo propio: manda el lienzo (blanco, o oscuro si lo declara).
      return cerrar(html.declaraOscuro ? 'dark' : 'light');
    }

    const luminancia = alfaHtml > 0.05
      ? body.color.a * luminance(body.color) + (1 - body.color.a) * lumHtml
      : luminanceOverWhite(body.color);

    return cerrar(luminancia <= UMBRAL_OSCURO ? 'dark' : 'light');
  }

  return {
    measure,
    isDark: () => resultado === 'dark',
    get decision() {
      return resultado;
    },
    get calls() {
      return llamadas;
    },
    reset() {
      resultado = null;
      llamadas = 0;
    }
  };
}
