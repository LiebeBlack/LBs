/* ============================================================================
   Mensajería entre capas. Contrato explícito y validado: nada de mensajes
   anónimos ni de `onMessage` que devuelve promesas sin control.
   ============================================================================ */

import { error, mensajeDeError } from './log.js';

export const MSG = Object.freeze({
  /** content → background: "¿esta pestaña está desactivada por el atajo?" */
  HELLO: 'pbn:hello',
  /** content (frame principal) → background: estado real para el badge. */
  REPORT: 'pbn:report',
  /** background → content (todos los frames): override de la pestaña. */
  TAB_STATE: 'pbn:tab-state',
  /** popup → content (frame principal): host real y estado aplicado. */
  QUERY_HOST: 'pbn:query-host'
});

function esMensaje(valido) {
  return typeof valido === 'object' && valido !== null && typeof valido.type === 'string';
}

/**
 * Envía un mensaje al background sin lanzar nunca. Devuelve `undefined` cuando
 * el contexto ya no existe (extensión recargada, pestaña descartada, página
 * privilegiada): es un caso normal, no un error que deba romper el arranque.
 */
export async function sendToBackground(mensaje) {
  if (!esMensaje(mensaje)) return undefined;
  try {
    return await browser.runtime.sendMessage(mensaje);
  } catch (err) {
    return undefined;
  }
}

/**
 * Envía un mensaje a una pestaña concreta. `tabs.sendMessage` no necesita
 * permisos de host: el destinatario son nuestros propios content scripts.
 */
export async function sendToTab(tabId, mensaje, opciones) {
  if (tabId === undefined || tabId === null || !esMensaje(mensaje)) return undefined;
  try {
    return await browser.tabs.sendMessage(tabId, mensaje, opciones);
  } catch (err) {
    return undefined;
  }
}

/**
 * Registra un manejador tipado. Devuelve la función para desregistrarlo, de
 * modo que el teardown (pagehide) pueda dejar el contexto limpio.
 */
export function onMessage(type, handler) {
  const objeto = browser.runtime?.onMessage;
  if (!objeto || typeof objeto.addListener !== 'function') return () => {};

  const listener = (mensaje, remitente) => {
    if (!esMensaje(mensaje) || mensaje.type !== type) return undefined;
    try {
      return handler(mensaje, remitente);
    } catch (err) {
      error(`fallo en el manejador de ${type}:`, mensajeDeError(err));
      return undefined;
    }
  };

  objeto.addListener(listener);
  return () => {
    try {
      objeto.removeListener(listener);
    } catch {
      /* contexto ya cerrado */
    }
  };
}
