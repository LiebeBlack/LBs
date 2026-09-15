/* ============================================================================
   Un ÚNICO MutationObserver, coalescido y acotado.

   · Agrupa los cambios en ventanas de 150 ms (una SPA que muta 1000 veces por
     segundo genera un lote, no mil tareas).
   · Lote de tamaño máximo: si se desborda, se avisa para hacer un barrido
     completo en lugar de ir acumulando nodos.
   · Pausa y desconexión reales cuando la pestaña no es visible.
   · Sin cascadas de re-escaneo: solo un lote por ráfaga.
   ============================================================================ */

import { error, mensajeDeError } from '../shared/log.js';

const ESPERA_MS = 150;
const MAX_NODOS = 400;

export function createObserver({ onBatch, maxNodos = MAX_NODOS, esperaMs = ESPERA_MS } = {}) {
  const candidatos = new Set(); // dedupe por lote; se vacía en cada flush (sin retención)
  let temporizador = null;
  let desbordado = false;
  let observando = false;

  const observador = new MutationObserver((registros) => {
    try {
      for (const registro of registros) {
        if (registro.type === 'attributes') {
          anadir(registro.target);
          continue;
        }
        for (const nodo of registro.addedNodes) {
          if (nodo && nodo.nodeType === 1) anadir(nodo);
        }
      }
    } catch (err) {
      error('fallo al acumular mutaciones:', mensajeDeError(err));
    }
    programar();
  });

  function anadir(elemento) {
    if (!elemento || elemento.nodeType !== 1) return;
    if (candidatos.size >= maxNodos) {
      desbordado = true;
      return;
    }
    candidatos.add(elemento);
  }

  function programar() {
    if (temporizador !== null || !observando) return;
    temporizador = setTimeout(flush, esperaMs);
  }

  function flush() {
    temporizador = null;
    if (!observando) return;
    const nodos = [...candidatos];
    const overflow = desbordado;
    candidatos.clear();
    desbordado = false;
    if (nodos.length === 0 && !overflow) return;
    try {
      onBatch?.({ nodes: nodos, overflow });
    } catch (err) {
      error('fallo al procesar un lote de mutaciones:', mensajeDeError(err));
    }
  }

  function start(root) {
    const objetivo = root ?? document.documentElement ?? document;
    if (!objetivo || observando) return false;
    try {
      observador.observe(objetivo, {
        childList: true,
        subtree: true,
        attributes: true,
        // `style` y `class` cambian lo que el sitio declara; `data-pbn-shadow`
        // es la señal que deja hook-main.js al crear una shadow root tarde, así
        // que tiene que despertar una tarea de corrección.
        attributeFilter: ['style', 'class', 'data-pbn-shadow']
      });
      observando = true;
      return true;
    } catch (err) {
      error('no se pudo observar el documento:', mensajeDeError(err));
      return false;
    }
  }

  function stop() {
    observando = false;
    if (temporizador !== null) {
      clearTimeout(temporizador);
      temporizador = null;
    }
    candidatos.clear();
    desbordado = false;
    try {
      observador.disconnect();
    } catch {
      /* ya desconectado */
    }
  }

  return {
    start,
    stop,
    get running() {
      return observando;
    },
    get pendingNodes() {
      return candidatos.size;
    }
  };
}
