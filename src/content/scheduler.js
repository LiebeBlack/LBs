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
/** Relevo tras agotar el presupuesto de la página: descansa y vuelve a intentarlo.
 *  Antes la parada era permanente y los elementos que llegaban después (scroll
 *  infinito, SPA, diálogos) quedaban para siempre sin corregir: texto oscuro
 *  ilegible sobre negro y bloques claros intactos. */
const RELLENO_MS = 3000;

export function createRunner({ sliceMs = 8, totalMs = 40, refillsMax = 3, onOverflow } = {}) {
  const cola = [];
  let enCurso = null;
  let idleId = null;
  let gastado = 0;
  let refills = 0;
  let activo = true;
  let colaDesbordada = false;
  let hechoTotal = 0;
  /** Ejecución en vivo: un relevo programado no debe sobrescribir nada. */
  let enMarcha = false;
  /** Hubo trabajo rechazado durante una pausa: el relevo lanza un barrido extra. */
  let trabajoPerdido = false;

  let relevoId = null;
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

  /** Programa la reanudación tras un agotamiento (descarta si hay una en vuelo). */
  function programarRelevo() {
    if (relevoId !== null || enMarcha) return;
    relevoId = setTimeout(() => {
      relevoId = null;
      gastado = 0;
      refills = 0;
      activo = true;
      if (trabajoPerdido) {
        trabajoPerdido = false;
        // Barrido de recuperación: lo llegado durante la pausa se cubre con un
        // barrido nuevo. Puede solaparse con la tarea reanudada, pero es
        // idempotente (hasMark), va en tiempo muerto y está acotado por
        // presupuesto; perder correcciones sería peor que repetir lecturas.
        if (typeof onOverflow === 'function') onOverflow();
      }
      bombea();
    }, RELLENO_MS);
  }

  function bombea() {
    if (idleId !== null || !activo) return;
    if (!enCurso && cola.length === 0) return;

    enMarcha = true;
    idleId = programarIdle(() => {
      idleId = null;
      enMarcha = false;
      const inicio = performance.now();
      // Los dos cortes (rebanada de 8 ms y presupuesto de 40 ms) son saltos
      // explícitos: el reloj y `gastado` son estado del gobernador, no de la
      // condición del bucle, y así el corte se lee tal cual ocurre.
      let agotado = false;
      try {
        while (true) {
          if (performance.now() - inicio >= sliceMs) break;
          if (gastado >= totalMs) {
            agotado = true;
            break;
          }
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

      if (agotado || gastado >= totalMs) {
        warn(`presupuesto de corrección agotado (${Math.round(gastado)} ms): pausa de ${RELLENO_MS} ms`);
        activo = false; // pausa: un relevo temporizado recupera el presupuesto
        // Se conserva TODO (la tarea en curso Y la cola): el relevo retoma el
        // trabajo en el mismo orden, sin perder lotes de mutaciones encolados.
        programarRelevo();
        return;
      }
      if (enCurso || cola.length > 0) {
        bombea();
        return;
      }
      if (colaDesbordada) {
        refills = 0; // el barrido de relevo vuelve a tener recargas disponibles
        colaDesbordada = false;
        if (typeof onOverflow === 'function') onOverflow();
      }
    });
  }

  function enqueue(tarea) {
    if (!activo || gastado >= totalMs) {
      // Sin presupuesto ahora: avisar para que el relevo recupere este trabajo.
      trabajoPerdido = true;
      return false;
    }
    if (!tarea || typeof tarea.next !== 'function') return false;
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
    if (relevoId !== null) {
      clearTimeout(relevoId);
      relevoId = null;
    }
    enCurso = null;
    cola.length = 0;
    trabajoPerdido = false;
    enMarcha = false; // el idle en vuelo fue cancelado: sin este reset, un relevo futuro se bloquearía
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
