/* ============================================================================
   Badge del icono.

   El background NO lee `tab.url`: sin los permisos `tabs`/host Firefox solo
   entrega url/title si el usuario concede acceso al sitio, así que el badge
   anterior acababa mostrando OFF en todas partes. Aquí el estado llega
   reportado por el propio content script (que sí conoce su host) y el badge se
   pinta con el `tabId` del remitente.
   ============================================================================ */

import { mensajeDeError, warn } from '../shared/log.js';

const COLOR_FONDO = '#ff2bd6';
const COLOR_TEXTO = '#000000';
const TEXTO_OFF = 'OFF';

function sinTab(tabId) {
  return tabId === undefined || tabId === null;
}

export async function setTabBadge(tabId, on) {
  if (sinTab(tabId)) return;
  try {
    await browser.action.setBadgeBackgroundColor({ tabId, color: COLOR_FONDO });
    await browser.action.setBadgeTextColor({ tabId, color: COLOR_TEXTO });
    await browser.action.setBadgeText({ tabId, text: on ? '' : TEXTO_OFF });
  } catch (err) {
    // Pestaña ya cerrada o navegación interna: no es un error del que informar.
    warn('no se pudo pintar el badge:', mensajeDeError(err));
  }
}

export async function clearTabBadge(tabId) {
  if (sinTab(tabId)) return;
  try {
    await browser.action.setBadgeText({ tabId, text: '' });
  } catch (err) {
    warn('no se pudo limpiar el badge:', mensajeDeError(err));
  }
}

/** Limpia el badge de todas las pestañas (al instalar o al arrancar el navegador). */
export async function clearAllBadges() {
  try {
    await browser.action.setBadgeText({ text: '' });
  } catch (err) {
    warn('no se pudieron limpiar los badges:', mensajeDeError(err));
  }
}
