/* ============================================================================
   Pure Black Neon v2.6 — popup.js

   · El interruptor de cabecera es SOLO global: antes escribía `enabled` global
     mientras mostraba el estado por sitio, así que con un sitio excluido el
     switch aparecía apagado y al activarlo apagaba la extensión en todas las
     webs. La exclusión vive ahora únicamente en su botón, con aria-pressed.
   · Guardado con acuse de recibo real (incluida la cuota de storage.sync).
   · Grupos de opciones con semántica de radiogroup y navegación por teclado.
   · Estado por pestaña visible: si el atajo desactivó esta pestaña, se dice y se
     ofrece reactivarla.
   ============================================================================ */

import { error, mensajeDeError } from '../shared/log.js';
import { MSG, sendToTab } from '../shared/messaging.js';
import { clearTabOff, isTabOff, loadState, onStateChanged, sanitizeState, saveState } from '../shared/settings.js';

const CLAVES_SEGMENTADO = ['engine', 'mode', 'accent'];
const ATAJO = 'Ctrl+Shift+L (⌘⇧L en macOS)';

let estado = sanitizeState(null);
let tabId = null;
let host = '';
let tabOff = false;
let avisoTimer = null;

const $ = (id) => document.getElementById(id);
const refs = {
  enabled: $('enabled'),
  engine: $('engine'),
  mode: $('mode'),
  accent: $('accent'),
  strict: $('strict'),
  eco: $('eco'),
  killAnim: $('kill-anim'),
  dimMedia: $('dim-media'),
  exclude: $('exclude'),
  host: $('host'),
  tabState: $('tab-state'),
  tabFix: $('tab-fix'),
  reset: $('reset'),
  status: $('status'),
  engineHint: $('engine-hint'),
  shortcut: $('shortcut')
};

const PISTAS_MOTOR = {
  invert: 'Inversión: colores del sitio casi originales y media re-invertida intacta.',
  amoled: 'AMOLED: negro #000000 estricto y acentos neón literales (sin invertir nada).'
};

/* ---------------------------------------------------------------------------
   Utilidades
   --------------------------------------------------------------------------- */

function aviso(texto, ok = true) {
  if (!refs.status) return;
  refs.status.textContent = texto;
  refs.status.classList.toggle('error', !ok);
  if (avisoTimer !== null) clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => {
    refs.status.textContent = '';
    refs.status.classList.remove('error');
    avisoTimer = null;
  }, ok ? 1500 : 4000);
}

async function guardar() {
  const resultado = await saveState(estado);
  aviso(resultado.ok ? 'Guardado' : 'No se pudo guardar (¿cuota de sync?)', resultado.ok);
  return resultado.ok;
}

function nombreHost() {
  return host || '—';
}

/* ---------------------------------------------------------------------------
   Render
   --------------------------------------------------------------------------- */

function marcarSegmentado(contenedor, valor) {
  if (!contenedor) return;
  for (const boton of contenedor.querySelectorAll('button[data-value]')) {
    const activo = boton.dataset.value === valor;
    boton.setAttribute('aria-checked', String(activo));
    boton.tabIndex = activo ? 0 : -1; // roving tabindex del patrón radiogroup
  }
}

function render() {
  const excluido = Boolean(host) && estado.excluded[host] === true;
  const sitioActivo = estado.enabled && !excluido && !tabOff;

  if (refs.enabled) refs.enabled.checked = estado.enabled;
  if (refs.strict) refs.strict.checked = estado.strict;
  if (refs.eco) refs.eco.checked = estado.eco;
  if (refs.killAnim) refs.killAnim.checked = estado.killAnim;
  if (refs.dimMedia) refs.dimMedia.checked = estado.dimMedia;

  marcarSegmentado(refs.engine, estado.engine);
  marcarSegmentado(refs.mode, estado.mode);
  marcarSegmentado(refs.accent, estado.accent);

  if (refs.engineHint) refs.engineHint.textContent = PISTAS_MOTOR[estado.engine] ?? '';
  if (refs.host) refs.host.textContent = host ? `${excluido ? 'OFF' : 'ON'} · ${host}` : '—';
  if (refs.exclude) {
    refs.exclude.textContent = excluido ? 'Incluir este sitio' : 'Excluir este sitio';
    refs.exclude.setAttribute('aria-pressed', String(excluido));
    refs.exclude.disabled = host === '';
  }
  if (refs.tabState) {
    refs.tabState.textContent = tabOff
      ? `El atajo (${ATAJO}) tiene el tema desactivado en esta pestaña.`
      : '';
  }
  if (refs.tabFix) refs.tabFix.hidden = !tabOff;

  document.body.classList.toggle('disabled', !sitioActivo);
}

/* ---------------------------------------------------------------------------
   Eventos
   --------------------------------------------------------------------------- */

function conectarSegmentados() {
  for (const clave of CLAVES_SEGMENTADO) {
    const contenedor = refs[clave];
    if (!contenedor) continue;

    contenedor.addEventListener('click', (evento) => {
      const boton = evento.target.closest('button[data-value]');
      if (!boton) return;
      estado[clave] = boton.dataset.value;
      marcarSegmentado(contenedor, estado[clave]);
      render();
      void guardar();
    });

    contenedor.addEventListener('keydown', (evento) => {
      const teclas = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!teclas.includes(evento.key)) return;
      const botones = [...contenedor.querySelectorAll('button[data-value]')];
      if (botones.length === 0) return;
      const actual = botones.findIndex((boton) => boton.dataset.value === estado[clave]);
      const desde = actual < 0 ? 0 : actual;

      let destino = desde;
      if (evento.key === 'Home') destino = 0;
      else if (evento.key === 'End') destino = botones.length - 1;
      else if (evento.key === 'ArrowLeft') destino = (desde - 1 + botones.length) % botones.length;
      else destino = (desde + 1) % botones.length;

      evento.preventDefault();
      botones[destino].focus();
      estado[clave] = botones[destino].dataset.value;
      marcarSegmentado(contenedor, estado[clave]);
      render();
      void guardar();
    });
  }
}

function conectarCasillas() {
  const mapa = [
    ['enabled', 'enabled'],
    ['strict', 'strict'],
    ['eco', 'eco'],
    ['killAnim', 'killAnim'],
    ['dimMedia', 'dimMedia']
  ];
  for (const [clave, nombre] of mapa) {
    const entrada = refs[clave];
    if (!entrada) continue;
    entrada.addEventListener('change', () => {
      estado[nombre] = entrada.checked;
      render();
      void guardar();
    });
  }
}

function conectarAcciones() {
  refs.exclude?.addEventListener('click', () => {
    if (!host) return;
    if (estado.excluded[host]) delete estado.excluded[host];
    else estado.excluded[host] = true;
    render();
    void guardar();
  });

  refs.reset?.addEventListener('click', () => {
    estado = sanitizeState(null);
    render();
    void guardar();
  });

  refs.tabFix?.addEventListener('click', () => {
    void (async () => {
      try {
        if (tabId === null) return;
        await clearTabOff(tabId);
        tabOff = false;
        await sendToTab(tabId, { type: MSG.TAB_STATE, off: false });
        render();
        aviso('Pestaña reactivada');
      } catch (err) {
        error('no se pudo reactivar la pestaña:', mensajeDeError(err));
        aviso('No se pudo reactivar la pestaña', false);
      }
    })();
  });

  if (refs.shortcut) refs.shortcut.textContent = `Atajo: ${ATAJO}`;
}

/* ---------------------------------------------------------------------------
   Datos iniciales
   --------------------------------------------------------------------------- */

async function resolverPestana() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const id = tab?.id ?? null;

    // El host se pide al content script (fuente fiable y sin permisos de URL);
    // tab.url queda solo como respaldo si el marco no responde.
    const respuesta = id === null ? undefined : await sendToTab(id, { type: MSG.QUERY_HOST }, { frameId: 0 });
    const hostDelMarco = respuesta && typeof respuesta.host === 'string' ? respuesta.host : '';
    const hostDeUrl = typeof tab?.url === 'string' ? new URL(tab.url).hostname : '';
    const fuera = id === null ? false : await isTabOff(id);

    // Un solo punto de escritura, ya sin awaits por medio: el estado publicado
    // no puede quedar a medias ni pisarse entre invocaciones solapadas.
    tabId = id;
    host = hostDelMarco || hostDeUrl || '';
    tabOff = fuera;
  } catch (err) {
    error('no se pudo resolver la pestaña activa:', mensajeDeError(err));
    tabId = null;
    host = '';
    tabOff = false;
  }
}

void (async () => {
  try {
    estado = await loadState();
    await resolverPestana();
    render();
  } catch (err) {
    error('fallo al inicializar el popup:', mensajeDeError(err));
    render();
  }
})();

conectarSegmentados();
conectarCasillas();
conectarAcciones();

// Si otro contexto cambia los ajustes (el atajo, otra ventana), el popup se
// vuelve a pintar en lugar de quedar desincronizado.
onStateChanged(() => {
  void (async () => {
    try {
      estado = await loadState();
      tabOff = tabId === null ? false : await isTabOff(tabId);
      render();
    } catch (err) {
      error('fallo al refrescar el popup:', mensajeDeError(err));
    }
  })();
});

// El nombre del host solo se muestra si existe; el resto de la UI ya está viva.
if (refs.host) refs.host.title = nombreHost();
