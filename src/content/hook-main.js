/* ============================================================================
   Hook MAIN-world de attachShadow (15 líneas útiles)               CAPA 2/3

   Se declara en el manifest con world:"MAIN", lo que sustituye al anterior
   browser.contentScripts.register (API solo MV2 en Firefox) y al <script>
   inline (bloqueado por la CSP del sitio), y no necesita ningún permiso.

   Contrato con el content script aislado: escribe el ATRIBUTO data-pbn-shadow
   en el host. Los atributos cruzan mundos; las propiedades expando no, porque
   la Xray vision las oculta (era el motivo de que el hook anterior nunca
   funcionara).

   Coste: dos defineProperty al arrancar cada frame y un setAttribute por shadow
   root creada. O(1), sin asignaciones y sin temporizadores. Se ejecuta siempre,
   pero el content script solo actúa sobre la marca cuando el motor AMOLED está
   activo: en el motor de inversión el filtro ya alcanza el shadow DOM.
   ============================================================================ */

(() => {
  'use strict';

  const MARCA = 'data-pbn-shadow';
  const PROPIETARIO = '__pbnAttachShadowHook__';

  try {
    const proto = Element.prototype;
    if (proto[PROPIETARIO]) return;

    const original = proto.attachShadow;
    if (typeof original !== 'function') return;

    const sustituto = function (init) {
      const root = original.call(this, init);
      try {
        this.setAttribute(MARCA, '');
      } catch {
        /* nodo en un documento inerte */
      }
      return root;
    };

    Object.defineProperty(proto, 'attachShadow', {
      value: sustituto,
      writable: true,
      configurable: true
    });
    Object.defineProperty(proto, PROPIETARIO, {
      value: true,
      writable: false,
      configurable: false
    });
  } catch {
    /* Prototipo bloqueado: la Capa 2 sigue viendo las raíces abiertas que ya
       conoce por elemento.shadowRoot, solo pierde las creadas más tarde. */
  }
})();
