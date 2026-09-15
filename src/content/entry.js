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
const PRESUPUESTO_PRINCIPAL = 4000;
const PRESUPUESTO_FRAME = 800;
const DOM_GRANDE = 60000;
const PRESUPUESTO_DOM_GRANDE = 1500;

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
  /** Evita apilar varios barridos diferidos esperando el mismo DOMContentLoaded. */
  let barridoDiferido = false;

  const runner = createRunner({
    sliceMs: 8,
    totalMs: 40,
    // refill() solo se usa al volver de una pestaña oculta (reanudar): tope alto
    // para que cada vuelta recupere presupuesto. El relevo tras un agotamiento
    // es interno del gobernador y no consume recargas.
    refillsMax: 8,
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
    // En document_start puede no existir <body> todavía: sin este relevo, la
    // primera pasada de correcciones de páginas estáticas nunca llegaba a
    // ejecutarse y quedaban textos oscuros sobre el negro.
    if (!document.body) {
      if (!barridoDiferido) {
        barridoDiferido = true;
        document.addEventListener('DOMContentLoaded', () => {
          barridoDiferido = false;
          encolarBarrido();
        }, { once: true });
      }
      return;
    }
    actualizarPresupuesto();
    // Si el gobernador agota su presupuesto a mitad de recorrido, conserva la
    // tarea y la reanuda donde estaba (scheduler.js): el barrido siempre acaba
    // cubriendo el documento, también en páginas enormes.    runner.enqueue(sweepPass(document.body, ctx));
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
      } else if (antesEngine !== null && antesEngine !== flags.engine) {
        // Cambio de motor en vivo: las marcas antiguas se borran más abajo y el
        // motor nuevo necesita su propio barrido (texto oscuro, iconos, fondos),
        // si nada más muta la página quedaría a medias hasta la próxima
        // mutación. El generador corre después de resetCorrections (idle).
        encolarBarrido();
      }
    } else {
      runner.stop();
    }

    // Cambiar de motor, apagar o entrar en modo eco invalida las marcas: son
    // específicas del motor y si no se borran quedarían aplicándose a un
    // documento distinto (y en eco la capa 2 debe quedar sin efecto real).
    if (!activo || estado.eco || (antesEngine !== null && antesEngine !== flags.engine)) {
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
    // Reaplicar atributos (el freeze pudo dejar `measuring`) y LUEGO barrir:
    // el observer estuvo parado mientras la pestaña estuvo oculta, así que las
    // mutaciones de ese periodo solo se descubren con un barrido explícito.
    // (`pintar` solo barrre en la transición apagado→encendido: aquí la pestaña
    // ya estaba activa y sin el barrido el contenido cambiado quedaría mal.)
    aplicar();
    if (!runner.refill()) runner.resume();
    encolarBarrido();
  }

  const alCambiarVisibilidad = () => {
    if (document.hidden) pausar();
    else reanudar();
  };

  const alMostrar = (evento) => {
    if (!evento.persisted) return;
    // bfcache: los listeners de mensajes se dieron de baja en pagehide.
    dejarDeEscucharMensajes = onMessage(MSG.TAB_STATE, (mensaje) => {
      tabOff = mensaje.off === true;
      aplicar();
      return undefined;
    });
    dejarDeResponderHost = onMessage(MSG.QUERY_HOST, () => ({
      host: hostOf(location.href),
      on: activo,
      engine: ctx.engine
    }));
    reanudar();
  };

  const alOcultar = () => {
    // pagehide NO implica destrucción (bfcache): se pausa y se dejan de escuchar
    // mensajes, pero los listeners de visibilidad persisten para poder reanudar
    // al volver. El de storage sigue activo a propósito (los ajustes cambian
    // desde el popup aunque la pestaña esté oculta).
    pausar();
    quitarMensajes();
  };

  let dejarDeEscucharMensajes = onMessage(MSG.TAB_STATE, (mensaje) => {
    tabOff = mensaje.off === true;
    aplicar();
    return undefined;
  });

  // El popup pregunta por el host real (así no necesita leer tab.url) y por el
  // estado que el motor tiene aplicado en este momento.
  let dejarDeResponderHost = onMessage(MSG.QUERY_HOST, () => ({
    host: hostOf(location.href),
    on: activo,
    engine: ctx.engine
  }));

  function quitarMensajes() {
    dejarDeEscucharMensajes();
    dejarDeResponderHost();
  }

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

  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  window.addEventListener('pagehide', alOcultar);
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
