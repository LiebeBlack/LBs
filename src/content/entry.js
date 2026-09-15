/* ============================================================================
   Pure Black Neon v2.6 — content.js (punto de entrada del content script)
   ----------------------------------------------------------------------------
   CAPA 0: contrato de arranque. Escribe los atributos por defecto de forma
           SÍNCRONA antes de cualquier await, de modo que el motor ya está
           activo en el primer pintado (cero destello blanco). Después
           reconcilia con el estado real de storage.
   CAPA 1: no hay código aquí: el tema lo pinta el CSS declarado en el manifest.
   CAPA 2: un único MutationObserver coalescido que encola tareas de corrección
           en el gobernador de presupuesto.
   CAPA 3: tampoco: cada corrección es un atributo que las hojas ya pintan.

   Sin recorridos de árbol en el arranque, sin temporizadores recurrentes y sin
   bucles de re-sondeo: si la página no muta, aquí no queda nada corriendo.
   ============================================================================ */

import { debug, error, mensajeDeError } from '../shared/log.js';
import { MSG, onMessage, sendToBackground } from '../shared/messaging.js';
import { frameFlags, hostOf, loadState, onStateChanged, sanitizeState } from '../shared/settings.js';
import { createAutoDetector } from './autodetect.js';
import { armDefaults, applyFlags, setMeasuring } from './engine.js';
import { resetCorrections } from './marks.js';
import { createObserver } from './observe.js';
import { batchPass, sweepPass } from './passes/smart.js';
import { createRunner, logStats } from './scheduler.js';

const CLAVE_CARGA = Symbol.for('pbn.loaded');
const PRESUPUESTO_PRINCIPAL = 2000;
const PRESUPUESTO_FRAME = 400;
const DOM_GRANDE = 20000;
const PRESUPUESTO_DOM_GRANDE = 800;

function yaCargado() {
  try {
    if (window[CLAVE_CARGA] === true) return true;
    window[CLAVE_CARGA] = true;
    return false;
  } catch {
    return false;
  }
}

function esFramePrincipal() {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

function iniciar() {
  if (yaCargado()) return;

  const root = document.documentElement;
  if (!root) return;

  const principal = esFramePrincipal();
  const basePresupuesto = principal ? PRESUPUESTO_PRINCIPAL : PRESUPUESTO_FRAME;

  const auto = createAutoDetector();
  const ctx = {
    engine: 'invert',
    presupuesto: { visitados: 0, max: basePresupuesto }
  };

  let estado = sanitizeState(null);
  let tabOff = false;
  let autoDark = false;
  let activo = false;
  let engineAplicado = null;
  let medicionHecha = false;

  const runner = createRunner({
    sliceMs: 8,
    totalMs: 40,
    refillsMax: 3,
    onOverflow: () => encolarBarrido()
  });

  const observer = createObserver({
    onBatch: ({ nodes, overflow }) => {
      // Nunca se escriben marcas con el motor apagado ni en modo eco.
      if (!activo || estado.eco) return;
      if (overflow) {
        encolarBarrido();
        return;
      }
      ctx.presupuesto.visitados = 0;
      runner.enqueue(batchPass(nodes, ctx));
    }
  });

  /* -------------------------------------------------------------------------
     Capa 0: defaults síncronos (antes de cualquier await)
     ------------------------------------------------------------------------- */
  armDefaults(root);

  function actualizarPresupuesto() {
    const total = document.getElementsByTagName('*').length;
    ctx.presupuesto.max = total > DOM_GRANDE ? Math.min(basePresupuesto, PRESUPUESTO_DOM_GRANDE) : basePresupuesto;
    ctx.presupuesto.visitados = 0;
  }

  function encolarBarrido() {
    if (!activo || estado.eco) return;
    actualizarPresupuesto();
    runner.enqueue(sweepPass(document.body ?? root, ctx));
  }

  function reportar() {
    if (!principal) return;
    void sendToBackground({ type: MSG.REPORT, on: activo });
  }

  function decidirAuto() {
    if (estado.mode !== 'auto') {
      autoDark = false;
      medicionHecha = true;
      return true;
    }
    const medida = auto.measure();
    if (medida === null) {
      medicionHecha = false;
      return false;
    }
    autoDark = medida === 'dark';
    medicionHecha = true;
    return true;
  }

  function pintar() {
    const flags = frameFlags(estado, { host: hostOf(location.href), tabOff, autoDark });
    const antesActivo = activo;
    const antesEngine = engineAplicado;

    activo = flags.active;
    ctx.engine = flags.engine;
    engineAplicado = flags.engine;
    applyFlags(root, flags);

    if (activo) {
      if (antesActivo !== true) {
        runner.resume();
        encolarBarrido();
      }
    } else {
      runner.stop();
    }

    // Cambiar de motor o apagar invalida las marcas: son específicas del motor
    // y si no se borran quedarían aplicándose a un documento distinto.
    if (!activo || (antesEngine !== null && antesEngine !== flags.engine)) {
      resetCorrections(document);
    }

    reportar();
  }

  function aplicar() {
    const decidido = decidirAuto();
    setMeasuring(root, !decidido);
    pintar();
    if (decidido) logStats(runner);
    return decidido;
  }

  /** Fase B del modo Auto: cuando ya existe <body>, se mide con datos reales. */
  function cerrarMedicion() {
    if (medicionHecha || document.body) {
      aplicar();
      return;
    }
    if (document.readyState !== 'loading') {
      aplicar();
      return;
    }
    document.addEventListener('DOMContentLoaded', () => {
      try {
        aplicar();
      } catch (err) {
        error('fallo al cerrar la medición automática:', mensajeDeError(err));
      }
    }, { once: true });
  }

  async function preguntarOverride() {
    const respuesta = await sendToBackground({ type: MSG.HELLO });
    tabOff = respuesta?.off === true;
  }

  /* -------------------------------------------------------------------------
     Ciclo de vida: visibilidad, bfcache, mensajes y ajustes
     ------------------------------------------------------------------------- */
  function pausar() {
    observer.stop();
    runner.stop();
  }

  function reanudar() {
    observer.start(root);
    if (!runner.refill()) runner.resume();
    encolarBarrido();
  }

  const alCambiarVisibilidad = () => {
    if (document.hidden) pausar();
    else reanudar();
  };

  const alMostrar = (evento) => {
    if (evento.persisted) reanudar();
  };

  const dejarDeEscucharMensajes = onMessage(MSG.TAB_STATE, (mensaje) => {
    tabOff = mensaje.off === true;
    aplicar();
    return undefined;
  });

  // El popup pregunta por el host real (así no necesita leer tab.url) y por el
  // estado que el motor tiene aplicado en este momento.
  const dejarDeResponderHost = onMessage(MSG.QUERY_HOST, () => ({
    host: hostOf(location.href),
    on: activo,
    engine: ctx.engine
  }));

  const dejarDeEscucharStorage = onStateChanged(() => {
    const modoPrevio = estado.mode;
    void (async () => {
      try {
        estado = await loadState();
        // Solo se vuelve a medir si el modo cambió: así una ráfaga de cambios
        // de ajustes no multiplica las lecturas de estilo.
        if (modoPrevio !== estado.mode) auto.reset();
        aplicar();
      } catch (err) {
        error('fallo al recargar los ajustes:', mensajeDeError(err));
      }
    })();
  });

  const alDescargar = () => {
    pausar();
    dejarDeEscucharMensajes();
    dejarDeResponderHost();
    dejarDeEscucharStorage();
    document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    window.removeEventListener('pagehide', alDescargar);
    window.removeEventListener('pageshow', alMostrar);
  };

  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  window.addEventListener('pagehide', alDescargar);
  window.addEventListener('pageshow', alMostrar);

  /* -------------------------------------------------------------------------
     Arranque
     ------------------------------------------------------------------------- */
  void (async () => {
    try {
      estado = await loadState();
      await preguntarOverride();
      aplicar();
      cerrarMedicion();
      observer.start(root);
      debug('listo', {
        engine: ctx.engine,
        activo,
        tabOff,
        host: hostOf(location.href),
        principal
      });
    } catch (err) {
      error('fallo en el arranque del content script:', mensajeDeError(err));
    }
  })();
}

try {
  iniciar();
} catch (err) {
  error('fallo al iniciar Pure Black Neon:', mensajeDeError(err));
}
