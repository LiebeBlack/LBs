/* ============================================================================
   Pure Black Neon v2.6 — background.js (página de eventos, no persistente)

   Responsabilidades mínimas y todas reactivas:
     · badge ON/OFF a partir del reporte del content script (nunca leyendo URLs)
     · atajo Ctrl+Shift+L: alterna el override de la pestaña en storage.session y
       avisa a TODOS los frames de esa pestaña (así los iframes nuevos heredan)
     · resolver el estado de la pestaña cuando un frame pregunta
     · limpieza de estado efímero en onInstalled/onStartup/onRemoved

   Todo se registra en el nivel superior: la página de eventos se despierta sola
   cuando llega un evento, y no guarda ningún estado en memoria que pueda
   perderse al suspenderse (los overrides viven en storage.session).
   ============================================================================ */

import { debug, error, mensajeDeError } from '../shared/log.js';
import { MSG, onMessage, sendToTab } from '../shared/messaging.js';
import { clearAllTabOff, clearTabOff, isTabOff, loadState, saveState, toggleTabOff } from '../shared/settings.js';
import { clearAllBadges, clearTabBadge, setTabBadge } from './badge.js';

const COMANDO_TOGGLE = 'toggle-dark';

/* ---------------------------------------------------------------------------
   Instalación y arranque
   --------------------------------------------------------------------------- */
browser.runtime.onInstalled.addListener((detalles) => {
  void (async () => {
    try {
      if (detalles?.reason === 'install') {
        // Sembrar el storage con el estado saneado: así la primera lectura del
        // popup y de los content scripts no depende de valores implícitos.
        await saveState(await loadState());
      }
      await clearAllBadges();
      debug('instalado/actualizado:', detalles?.reason);
    } catch (err) {
      error('fallo en onInstalled:', mensajeDeError(err));
    }
  })();
});

browser.runtime.onStartup.addListener(() => {
  void (async () => {
    try {
      // Los tabId no sobreviven al reinicio: los overrides por pestaña caducan.
      await clearAllTabOff();
      await clearAllBadges();
    } catch (err) {
      error('fallo en onStartup:', mensajeDeError(err));
    }
  })();
});

/* ---------------------------------------------------------------------------
   Mensajes
   --------------------------------------------------------------------------- */

// Un frame nuevo pregunta si su pestaña está desactivada por el atajo: así el
// estado es consistente incluso en iframes creados después del toque.
onMessage(MSG.HELLO, async (_mensaje, remitente) => {
  const tabId = remitente?.tab?.id;
  return { off: await isTabOff(tabId) };
});

// El frame principal reporta el estado real aplicado: es la única fuente del badge.
onMessage(MSG.REPORT, (mensaje, remitente) => {
  void setTabBadge(remitente?.tab?.id, mensaje.on === true);
  return undefined;
});

/* ---------------------------------------------------------------------------
   Pestañas
   --------------------------------------------------------------------------- */

// Al empezar una navegación el badge anterior ya no representa nada: se limpia.
// No hace falta leer la URL para eso.
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo?.status === 'loading') void clearTabBadge(tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  void clearTabOff(tabId);
});

/* ---------------------------------------------------------------------------
   Atajo de teclado
   --------------------------------------------------------------------------- */
browser.commands.onCommand.addListener((comando) => {
  if (comando !== COMANDO_TOGGLE) return;
  void (async () => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;
      if (tabId === undefined || tabId === null) return;

      const off = await toggleTabOff(tabId);
      // El propio content script reaplica y reporta el badge: el background no
      // necesita saber el host ni los ajustes para pintarlo.
      await sendToTab(tabId, { type: MSG.TAB_STATE, off });
      debug('atajo:', { tabId, off });
    } catch (err) {
      error('fallo al alternar el tema con el atajo:', mensajeDeError(err));
    }
  })();
});
