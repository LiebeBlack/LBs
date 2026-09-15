/* ============================================================================
   Gobernador de presupuesto de la Capa 2.

   Reglas duras:
     · cada rebanada trabaja como máximo `sliceMs` (8 ms por defecto);
     · el total por página no puede pasar de `totalMs` (40 ms); al agotarse, las
       correcciones se apagan solas (degradación elegante: mejor un sitio oscuro
       con alguna foto invertida que una página congelada);
     · siempre en tiempo muerto del navegador (requestIdleCallback);
     · la cola está acotada y, si se desborda, avisa para lanzar un barrido
       completo en lugar de acumular trabajo.

   El trabajo se escribe como generadores que ceden una vez por nodo; así el
   corte por tiempo es real, la ejecución es incremental y el estado queda
   pausado sin callbacks anidados.
   ============================================================================ */

import { debug, mensajeDeError, warn } from '../shared/log.js';

const MAX_COLA = 4;
const TIMEOUT_IDLE = 600;

export function createRunner({ sliceMs = 8, totalMs = 40, refillsMax = 3, onOverflow } = {}) {
  const cola = [];
  let enCurso = null;
  let idleId = null;
  let gastado = 0;
  let refills = 0;
  let activo = true;
  let colaDesbordada = false;
  let hechoTotal = 0;

  const programarIdle = (callback) => {
    if (typeof requestIdleCallback === 'function') {
      return requestIdleCallback(callback, { timeout: TIMEOUT_IDLE });
    }
    return setTimeout(() => callback({ timeRemaining: () => 0, didTimeout: true }), 16);
  };

  const cancelarIdle = (id) => {
    if (id === null) return;
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(id);
    else clearTimeout(id);
  };

  function bombea() {
    if (idleId !== null || !activo) return;
    if (!enCurso && cola.length === 0) return;

    idleId = programarIdle(() => {
      idleId = null;
      const inicio = performance.now();
      try {
        while (performance.now() - inicio < sliceMs && gastado < totalMs) {
          if (!enCurso) {
            enCurso = cola.shift() ?? null;
            if (!enCurso) break;
          }
          const paso = enCurso.next();
          hechoTotal += 1;
          if (paso.done) enCurso = null;
        }
      } catch (err) {
        warn('una tarea de corrección falló y se descarta:', mensajeDeError(err));
        enCurso = null;
      }

      gastado += performance.now() - inicio;

      if (gastado >= totalMs) {
        warn(`presupuesto de corrección agotado (${Math.round(gastado)} ms): se deja de analizar esta página`);
        activo = false; // parada dura: se recupera con refill() tras volver de una pestaña oculta
        enCurso = null;
        cola.length = 0;
        return;
      }
      if (enCurso || cola.length > 0) {
        bombea();
        return;
      }
      if (colaDesbordada) {
        colaDesbordada = false;
        if (typeof onOverflow === 'function') onOverflow();
      }
    });
  }

  function enqueue(tarea) {
    if (!activo || !tarea || typeof tarea.next !== 'function') return false;
    if (gastado >= totalMs) return false;
    if (cola.length >= MAX_COLA) {
      colaDesbordada = true;
      return false;
    }
    cola.push(tarea);
    bombea();
    return true;
  }

  function stop() {
    activo = false;
    cancelarIdle(idleId);
    idleId = null;
    enCurso = null;
    cola.length = 0;
  }

  function resume() {
    activo = true;
    bombea();
  }

  /** Devuelve presupuesto tras volver de una pestaña oculta (con tope). */
  function refill() {
    if (refills >= refillsMax) return false;
    refills += 1;
    gastado = 0;
    enCurso = null;
    cola.length = 0;
    activo = true;
    bombea();
    return true;
  }

  return {
    enqueue,
    stop,
    resume,
    refill,
    stats() {
      return {
        spentMs: Math.round(gastado * 100) / 100,
        steps: hechoTotal,
        pending: cola.length + (enCurso ? 1 : 0),
        idleScheduling: typeof requestIdleCallback === 'function'
      };
    }
  };
}

/** Registra el coste real de la capa 2 cuando el desarrollador activa la depuración. */
export function logStats(runner) {
  debug('capa 2:', runner.stats());
}
