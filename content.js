/* ============================================================
   Pure Black Neon v2.2 — content.js
   Motor: sin librerías, sin fugas, sin errores.
   - Aplica el modo vía atributos en <html> (el CSS hace el trabajo)
   - MODO AUTO: mide la luminancia del fondo real del sitio; si ya
     es oscuro NO lo toca (cero atributos, cero coste). Si es claro,
     actúa en modo Forzado.
   - Análisis de luminancia en estilos inline (texto invisible)
   - Shadow DOM abierto + hook de attachShadow para raíces futuras
   - MutationObserver con debounce, presupuesto y pausa en oculto
   - Reacciona en vivo al popup vía storage.onChanged
   ============================================================ */
(() => {
  'use strict';

  if (window.__pbnLoaded) return;            // blindaje anti doble-inyección
  window.__pbnLoaded = true;

  const AUTO_DARK_THRESHOLD = 0.12;          // luminancia efectiva: < esto = ya oscuro

  const DEFAULTS = Object.freeze({
    enabled: true,
    mode: 'auto',                            // 'auto' | 'on' | 'force' | 'turbo'
    accent: 'multi',                         // 'multi' | 'green' | 'cyan' | 'magenta'
    killAnim: false,                         // congelar animaciones
    dimMedia: false,                         // atenuar imágenes/videos
    excluded: {}                             // { [host]: true }
  });

  let state = { ...DEFAULTS };
  let tabEnabled = true;                     // override efímero (Ctrl+Shift+L)
  const scanned = new WeakSet();             // nodos ya analizados (sin fugas)
  const shadowDone = new WeakSet();          // shadow roots ya vestidos
  let autoWaiter = false;                    // DCL armado para auto (una vez)
  let autoProbeTimer = null;                 // sonda diferida para fondos transparentes

  /* ---------------- utilidades de color ---------------- */

  const RE_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const RE_FN  = /^(rgba?|hsla?)\(([^)]*)\)$/i;

  function chan(hex, i, len) {               // componente hex 0-255
    const v = len === 1 ? hex[i] + hex[i] : hex.slice(i, i + 2);
    return parseInt(v, 16);
  }

  function hexToRgba(hex) {
    const h = hex.slice(1);
    if (h.length === 3 || h.length === 4) {
      return { r: chan(h, 0, 1), g: chan(h, 1, 1), b: chan(h, 2, 1), a: h.length === 4 ? chan(h, 3, 1) / 255 : 1 };
    }
    return { r: chan(h, 0, 2), g: chan(h, 2, 2), b: chan(h, 4, 2), a: h.length === 8 ? chan(h, 6, 2) / 255 : 1 };
  }

  function hslToRgba(h, s, l, a) {
    h = ((h % 360) + 360) % 360 / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = t => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255, a };
  }

  function parseColor(token) {
    token = token.trim().toLowerCase();
    if (RE_HEX.test(token)) return hexToRgba(token);
    const m = RE_FN.exec(token);
    if (!m) return null;
    const parts = m[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const pct = v => v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
    const alpha = parts[3] !== undefined ? Math.min(1, Math.max(0, pct(parts[3]))) : 1;
    if (m[1][0] === 'h') {
      const h = parseFloat(parts[0]) || 0;
      const s = Math.min(1, Math.max(0, pct(parts[1])));
      const l = Math.min(1, Math.max(0, pct(parts[2])));
      return hslToRgba(h, s, l, alpha);
    }
    return {
      r: pct(parts[0]) * (parts[0].endsWith('%') ? 255 : 1),
      g: pct(parts[1]) * (parts[1].endsWith('%') ? 255 : 1),
      b: pct(parts[2]) * (parts[2].endsWith('%') ? 255 : 1),
      a: alpha
    };
  }

  /* luminancia relativa WCAG (0 = negro, 1 = blanco) */
  function luminance(c) {
    const lin = v => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  }

  /* ---------------- MODO AUTO: luminancia efectiva del sitio ----------------
   Recorre html→body→wrapper buscando el primer fondo real (opaco) y devuelve
   su luminancia compuesta. -1 = aún indeciso (sin body o todo transparente).
   -------------------------------------------------------------------------- */

  function effectiveLum() {
    try {
      if (!document.body) return -1;
      let acc = 1;                            // composición sobre blanco (peor caso)
      let found = false;
      for (let el = document.body; el; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        const c = parseColor(bg);
        if (!c || c.a <= 0) continue;
        found = true;
        acc = acc * (1 - c.a) + luminance(c) * c.a;
        if (c.a >= 0.95) break;               // fondo opaco: decidido
      }
      if (!found) return -1;                  // todo transparente (averiguar luego)
      return acc;
    } catch (_) {
      return -1;
    }
  }

  /* ---------------- análisis inteligente de estilos inline ----------------
   Detecta (sin mutar los estilos del sitio):
     color con luminancia efectiva casi nula → [data-pbn-fix]  (texto invisible
     sobre el negro que acabamos de imponer)
   ------------------------------------------------------------------------ */

  function analyzeElement(el) {
    if (scanned.has(el)) return;
    scanned.add(el);
    const styleAttr = el.getAttribute && el.getAttribute('style');
    if (!styleAttr) return;

    for (const decl of styleAttr.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim();
      if (prop !== 'color' || (!value.startsWith('#') && !value.includes('('))) continue;

      const color = parseColor(value);
      if (!color) continue;
      const effective = color.a * luminance(color);   // composición sobre negro

      if (effective < 0.09) {
        el.setAttribute('data-pbn-fix', '');          // texto casi invisible
        break;                                        // una marca basta
      }
    }
  }

  function scanTree(node, budget) {
    if (!node || budget <= 0) return budget;
    if (node.nodeType === 1) {
      analyzeElement(node);
      --budget;
      if (node.shadowRoot) {
        dressShadowRoot(node.shadowRoot);
      } else if (node.__pbnOpenRoot) {       // root creado tras el arranque (hook MAIN)
        dressShadowRoot(node.__pbnOpenRoot);
        try { delete node.__pbnOpenRoot; } catch (_) {}
      }
      for (const child of node.childNodes) {
        budget = scanTree(child, budget);
        if (budget <= 0) break;
      }
    }
    return budget;
  }

  /* ---------------- Shadow DOM ---------------- */

  const SHADOW_CSS = `
    :host { background-color: #000 !important; color: var(--pbn-fg, #c9d1d9) !important; }
    :host a { color: var(--pbn-accent2, #00e5ff) !important; }
    :host h1, :host h2, :host h3, :host h4, :host h5, :host h6 { color: var(--pbn-fg-hi, #f0f6fc) !important; }
    :host input, :host textarea, :host select, :host button {
      background: var(--pbn-input, #0d1117) !important; color: inherit !important; }
    ::selection { background: var(--pbn-accent3, #ff2bd6) !important; color: #000 !important; }`;

  function dressShadowRoot(root) {
    if (shadowDone.has(root)) return;
    shadowDone.add(root);
    try {
      const style = document.createElement('style');
      style.textContent = SHADOW_CSS;
      root.prepend(style);
      let i = 0;
      for (const el of root.querySelectorAll('*')) {
        if (++i > 300) break;             // tope por raíz
        analyzeElement(el);
      }
    } catch (_) { /* root cerrado o detachado: ignorar */ }
  }

  /* ---------------- Hook MAIN-world de attachShadow ----------------
     Se registra con browser.contentScripts.register({ world: 'MAIN' })
     (Firefox 135+): corre en el mundo de la página, sobrevive a cualquier
     CSP y marca cada host cuyo shadow root se cree más tarde, para
     vestirlo al re-escanear. Fallback: inyección inline (CSP-sensible). */

  const HOOK_CODE = `(() => { try {
    if (Element.prototype.__pbnHooked) return;
    Element.prototype.__pbnHooked = true;
    const orig = Element.prototype.attachShadow;
    if (typeof orig !== 'function') return;
    Element.prototype.attachShadow = function (init) {
      const root = orig.call(this, init);
      try { if (root) this.__pbnOpenRoot = root; } catch (_) {}
      return root;
    };
  } catch (_) {} })();`;

  let mainHookHandle = null;

  async function hookAttachShadow() {
    if (mainHookHandle) return;
    try {
      mainHookHandle = await browser.contentScripts.register({
        matches: ['<all_urls>'],
        js: [{ code: HOOK_CODE }],
        world: 'MAIN',
        runAt: 'document_start',
        allFrames: true,
        matchAboutBlank: true
      });
    } catch (_) {
      try {
        const script = document.createElement('script');
        script.textContent = HOOK_CODE;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
      } catch (_) { /* CSP estricta: queda el escaneo de raíces abiertas */ }
    }
  }

  /* ---------------- aplicación del modo ---------------- */

  function hostName() {
    try { return location.hostname || ''; } catch (_) { return ''; }
  }

  function effectiveEnabled() {
    return state.enabled && tabEnabled && !state.excluded[hostName()];
  }

  function clearAttrs(root) {
    root.removeAttribute('data-pbn');
    root.removeAttribute('data-pbn-accent');
    root.removeAttribute('data-pbn-killanim');
    root.removeAttribute('data-pbn-dimmedia');
  }

  function setModeAttrs(root, mode) {
    root.setAttribute('data-pbn', mode);
    if (state.accent && state.accent !== 'multi') root.setAttribute('data-pbn-accent', state.accent);
    else root.removeAttribute('data-pbn-accent');
    root.toggleAttribute('data-pbn-killanim', !!state.killAnim);
    root.toggleAttribute('data-pbn-dimmedia', !!state.dimMedia);
  }

  function armAutoProbe() {
    if (autoProbeTimer !== null) return;
    autoProbeTimer = setTimeout(() => {
      autoProbeTimer = null;
      if (state.mode === 'auto' && effectiveEnabled()) apply();
    }, 1200);   // deja cargar CSS webfonts/hojas diferidas y vuelve a medir
  }

  function apply() {
    const root = document.documentElement;
    if (!root) return;
    if (!effectiveEnabled()) {
      clearAttrs(root);
      return;
    }

    if (state.mode === 'auto') {
      if (!document.body) {
        // document_start: decidir en cuanto haya <body> (una sola vez)
        if (!autoWaiter) {
          autoWaiter = true;
          document.addEventListener('DOMContentLoaded', () => {
            autoWaiter = false;
            apply();
          }, { once: true });
        }
        return;
      }
      const lum = effectiveLum();
      if (lum >= 0 && lum < AUTO_DARK_THRESHOLD) {
        setModeAttrs(root, 'force');          // sitio claro → Forzado
        return;
      }
      if (lum >= AUTO_DARK_THRESHOLD) {
        clearAttrs(root);                     // sitio ya oscuro → no tocar NADA
        return;
      }
      // fondo transparente por ahora: quedamos inertes y re-medimos
      armAutoProbe();
      clearAttrs(root);
      return;
    }

    setModeAttrs(root, state.mode === 'force' ? 'force' : state.mode === 'turbo' ? 'turbo' : 'on');
  }

  /* ---------------- MutationObserver con debounce ---------------- */

  const BUDGET = 400;                        // nodos analizados por lote (tope duro)
  let pendingRecords = null;
  let timer = null;

  function schedule() {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      const records = pendingRecords;
      pendingRecords = null;
      if (!records || !effectiveEnabled()) return;
      let budget = BUDGET;
      for (const rec of records) {
        if (rec.type === 'attributes') {
          scanned.delete(rec.target);       // su style cambió: re-analizar
          analyzeElement(rec.target);
        } else {
          for (const node of rec.addedNodes) budget = scanTree(node, budget);
        }
        if (budget <= 0) break;
      }
    }, 120);
  }

  const observer = new MutationObserver(records => {
    pendingRecords = pendingRecords ? pendingRecords.concat(records) : records;
    schedule();
  });

  function observe() {
    try {
      observer.observe(document.documentElement || document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['style']
      });
    } catch (_) { /* sin raíz todavía: se reintenta en boot */ }
  }

  /* pausa total en pestañas ocultas: 0 % de CPU en segundo plano */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      observer.disconnect();
    } else if (effectiveEnabled()) {
      apply();                               // re-decide (modo auto incluido)
      observe();
      pendingRecords = null;
      if (document.body) scanTree(document.body, BUDGET);
    }
  });

  /* ---------------- mensajes del background (atajo de teclado) ---------------- */

  try {
    browser.runtime.onMessage.addListener(msg => {
      if (!msg) return;
      if (msg.type === 'pbn:toggle-tab') {
        tabEnabled = !tabEnabled;
        apply();
      }
    });
  } catch (_) { /* contexto extendido no listo */ }

  /* ---------------- storage: estado + reacción en vivo ---------------- */

  function sanitize(raw) {
    const s = { ...DEFAULTS, ...raw };
    if (typeof s.excluded !== 'object' || s.excluded === null || Array.isArray(s.excluded)) {
      s.excluded = {};
    }
    s.enabled = !!s.enabled;
    s.killAnim = !!s.killAnim;
    s.dimMedia = !!s.dimMedia;
    if (!['auto', 'on', 'force', 'turbo'].includes(s.mode)) s.mode = 'auto';
    if (!['multi', 'green', 'cyan', 'magenta'].includes(s.accent)) s.accent = 'multi';
    return s;
  }

  async function loadState() {
    try {
      state = sanitize(await browser.storage.sync.get(DEFAULTS));
    } catch (_) {
      state = { ...DEFAULTS, excluded: {} };
    }
  }

  async function boot() {
    apply();
    hookAttachShadow();
    observe();
    if (document.body) {
      scanTree(document.body, BUDGET);
    } else {
      // document_start: el <body> aún no existe; escanear al llegar
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) scanTree(document.body, BUDGET);
      }, { once: true });
    }
  }

  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') loadState().then(boot);
    });
  } catch (_) { /* ignorar */ }

  /* ---------------- arranque antes del primer paint ---------------- */

  (async () => {
    await loadState();
    boot();
  })();
})();
