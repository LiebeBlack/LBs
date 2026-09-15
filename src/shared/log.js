/* ============================================================================
   Registro mínimo y silencioso.

   Los errores salen siempre (son la única señal que el usuario ve en
   about:debugging). El detalle verboso queda detrás de una bandera que se puede
   activar desde la consola sin recompilar nada:

     globalThis.__PBN_DEBUG__ = true

   Así ningún `catch` vuelve a tragarse un fallo en silencio.
   ============================================================================ */

const ETIQUETA = '[PBN]';

function depuracionActiva() {
  return globalThis.__PBN_DEBUG__ === true;
}

export function debug(...args) {
  if (depuracionActiva()) console.debug(ETIQUETA, ...args);
}

export function warn(...args) {
  if (depuracionActiva()) console.warn(ETIQUETA, ...args);
}

export function error(...args) {
  console.error(ETIQUETA, ...args);
}

export function mensajeDeError(err) {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
