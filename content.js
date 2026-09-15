/* ============================================================
   Pure Black Neon v2.5 — content.js
   Motor: sin librerías, sin fugas, sin errores.
   - Aplica el modo vía atributos en <html> (el CSS hace el trabajo)
   - MODO AUTO: mide la luminancia del fondo real del sitio; si ya
     es oscuro NO lo toca (cero atributos, cero coste). Si es claro,
     actúa en modo Forzado. Si declara oscuro pero sus primeros hijos
     pintan claro (fondo con JS), re-mide y decide con datos reales.
   - Análisis inteligente de estilos inline, sin mutar los del sitio:
       · texto invisible sobre negro      → [data-pbn-fix]
       · fondo claro / gradiente inline   → [data-pbn-bg]
       · icono SVG que heredaría fill:0   → [data-pbn-svgfix]
   - Pase profundo con estilos computados: rescata el texto gris que
     los sitios fijan por CLASES CSS (color gris sobre fondo blanco,
     ahora invisible sobre nuestro negro). Sabe distinguir cromáticos
     de neutros y no toca media ni contenedores claros rescatados.
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
  let autoProbeCount = 0;                    // nº de re-sondeos AUTO ya armados

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

  /* máxima desviación de canal respecto al gris: 0 = neutro, ~127 = muy cromático */
  function chroma(c) {
    return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  }

  /* ---------------- MODO AUTO: luminancia efectiva del sitio ----------------
   Recorre html→body→wrapper buscando el primer fondo real (opaco) y devuelve
   su luminancia compuesta. -1 = aún indeciso (sin body o todo transparente).
   Si el sitio declara oscuro pero sus primeros hijos pintan un bloque claro
   (fondos inyectados con JS), re-compone con el hijo real y decide con eso.
   Con contenido vivo (vídeo/canvas/marquee) confía en la declaración del
   sitio: oscurecer un reproductor en marcha sería peor remedio.
   -------------------------------------------------------------------------- */

  const AUTO_PROBE_MAX = 40;                 // hijos de <body> sondeados como mucho
  const AUTO_MIN_OPACITY = 0.15;             // debajo: invisible sobre el negro

  function hasMeaningfulMotion() {
    try {
      let i = 0;
      for (const el of document.body.querySelectorAll('video, canvas, marquee')) {
        if (++i > 50) break;
        if (el.tagName === 'VIDEO' || el.tagName === 'MARQUEE') return true;
        if (el.tagName === 'CANVAS') {
          const c = parseColor(getComputedStyle(el).backgroundColor);
          if (c && c.a >= AUTO_MIN_OPACITY) return true;   // lienzo pintado y vivo
        }
      }
    } catch (_) {}
    return false;
  }

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
      if (acc >= AUTO_DARK_THRESHOLD) {
        // El sitio declara oscuro pero podría pintarlo luego con JS:
        // sondeamos los primeros hijos directos de <body>.
        let i = 0;
        for (const el of document.body.children) {
          if (++i > AUTO_PROBE_MAX) break;
          const c = parseColor(getComputedStyle(el).backgroundColor);
          if (!c || c.a <= 0) continue;
          const op = acc * (1 - c.a) + luminance(c) * c.a;   // efectivo sobre el fondo actual
          if (op >= 0.25) {
            if (hasMeaningfulMotion()) return acc;           // hay contenido vivo: confiar
            acc = op;
            break;
          }
        }
      }
      return acc;
    } catch (_) {
      return -1;
    }
  }

  /* ---------------- análisis inteligente de estilos inline ----------------
   Detecta (sin mutar los estilos del sitio):
     color con luminancia efectiva casi nula          → [data-pbn-fix]
       (texto invisible sobre el negro que acabamos de imponer)
     background claro u opaco (incl. gradientes)      → [data-pbn-bg]
       (bloque claro inline que rompería el diseño; los que llevan
       url() se respetan: es una imagen de fondo legítima)
     -webkit-text-fill-color oscuro                   → [data-pbn-fix]
       (texto degradado de sitios claros quedaría invisible)
   ------------------------------------------------------------------------ */

  const RE_GRADIENT = /^\s*(linear|radial|conic)-gradient\s*\(/i;
  const RE_URL = /\burl\s*\(/i;

  function analyzeElement(el) {
    if (scanned.has(el)) return;
    scanned.add(el);
    const styleAttr = el.getAttribute && el.getAttribute('style');
    if (!styleAttr) return;

    let invisible = false;
    let lightBlock = false;
    for (const decl of styleAttr.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim();
      if (!value || value.startsWith('var(')) continue;

      if (prop === 'color' || prop === '-webkit-text-fill-color') {
        if (!value.startsWith('#') && !value.includes('(')) continue;
        const color = parseColor(value);
        if (!color) continue;
        if (color.a * luminance(color) < 0.09) invisible = true;
      } else if (prop === 'background' || prop === 'background-color') {
        if (value === 'transparent' || RE_URL.test(value)) continue;
        if (RE_GRADIENT.test(value)) { lightBlock = true; continue; }  // gradiente: asumir bloque
        const bg = parseColor(value);
        if (bg && bg.a >= 0.35 && luminance(bg) > 0.32) lightBlock = true;
      }
    }

    if (invisible) el.setAttribute('data-pbn-fix', '');   // texto casi invisible
    if (lightBlock) el.setAttribute('data-pbn-bg', '');   // fondo claro inline
  }

  /* ---------------- pase profundo: estilos computados ----------------
   Los sitios serios ya no usan estilos inline: fijan el texto con CLASES
   CSS (p. ej. .muted { color: #6a737d }) pensado para fondo blanco. Tras
   imponer nuestro negro, ese texto queda invisible. Este pase lo detecta
   con getComputedStyle y lo marca con [data-pbn-fix2], con criterio:
     · solo texto realmente oscuro (lum. efectiva < 0.09)
     · el sitio debe haber declarado color "propio" (no heredado ni default)
     · colores cromáticos se respetan (marca de la web, no gris de texto)
     · nunca dentro de media, code/pre/kbd, ni bloques claros rescatados
     · presupuesto pequeño: sondeo fino, nunca un cuello de botella
   -------------------------------------------------------------------- */

  const DEEP_MAX = 600;                      // nodos sondeados por pase

  function skipDeepNode(el) {
    const tag = el.tagName;
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'SVG' ||
        tag === 'IFRAME' || tag === 'AUDIO' || tag === 'PICTURE' || tag === 'SOURCE' ||
        tag === 'EMBED' || tag === 'OBJECT' || tag === 'TRACK' || tag === 'MAP') return true;
    if (tag === 'PRE' || tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' ||
        tag === 'VAR' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' ||
        tag === 'INPUT' || tag === 'SELECT' || tag === 'OPTION' || tag === 'TEMPLATE') return true;
    return el.hasAttribute('data-pbn-bg');   // dentro de un bloque claro rescatado el gris sí es válido
  }

  function deepScan(root, budget) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (skipDeepNode(node)) return NodeFilter.FILTER_REJECT;   // no bajar en media
        if (node.childElementCount === 0 && (node.textContent || '').trim()) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    let count = 0;
    while (walker.nextNode() && count < budget && count < DEEP_MAX) {
      const el = walker.currentNode;
      const cs = getComputedStyle(el);
      const col = parseColor(cs.color);
      if (!col || col.a <= 0) continue;
      // Color efectivo sobre el fondo ya oscurecido: si es casi negro, es texto invisible.
      if (col.a * luminance(col) >= 0.09) continue;
      // Solo colores "propios": un color heredado/default lo corrige la cascada base.
      if (!cs.getPropertyValue('--pbn-owner')) {
        if (col.a >= 0.99 && chroma(col) < 10) continue;           // neutro opaco no declarado: es heredado
      }
      // Respetar intencionalidad: si declara color, lo marcamos; si no, heredó.
      el.setAttribute('data-pbn-fix2', '');
      ++count;
    }
    return count;
  }

  function scanTree(node, budget) {
    if (!node || budget <= 0) return budget;
    if (node.nodeType === 1) {
      analyzeElement(node);
      // Icono SVG sin fill propio: con la base a #000, fill:inherit lo
      // dejaría negro (invisible). Lo marcamos para pintarlo con acento.
      if (node.namespaceURI === 'http://www.w3.org/2000/svg' &&
          !node.closest('[fill]:not([fill="inherit"]), [style*="fill"]')) {
        node.setAttribute('data-pbn-svgfix', '');
      }
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
    :host(:not(svg)) * { color: inherit; }
    :host a { color: var(--pbn-accent2, #00e5ff) !important; }
    :host h1, :host h2, :host h3, :host h4, :host h5, :host h6 { color: var(--pbn-fg-hi, #f0f6fc) !important; }
    :host input, :host textarea, :host select, :host button {
      background: var(--pbn-input, #0d1117) !important; color: inherit !important; }
    :host img, :host video, :host canvas { background: transparent; }
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
    if (autoProbeTimer !== null || autoProbeCount >= 3) return;   // hasta 3 re-mediciones
    ++autoProbeCount;
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
      const attrTargets = [];              // deduplicación: un style con 5 cambios = 1 análisis
      let treeBudget = budget;
      for (const rec of records) {
        if (rec.type === 'attributes') {
          if (!attrTargets.includes(rec.target)) attrTargets.push(rec.target);
        } else {
          for (const node of rec.addedNodes) treeBudget = scanTree(node, treeBudget);
        }
        if (treeBudget <= 0) break;
      }
      for (const el of attrTargets) {
        if (treeBudget <= 0) break;
        scanned.delete(el);                // su style cambió: re-analizar
        analyzeElement(el);
        --treeBudget;
      }
    }, 120);
  }

  const observer = new MutationObserver(records => {
    pendingRecords = pendingRecords ? pendingRecords.concat(records) : records;
    schedule();
    scheduleDeepScan();                     // contenido dinámico también se rescata
  });

  /* Pase profundo con backoff: el texto gris fijado por clases CSS puede
     llegar en cualquier momento (SPA, scroll infinito). Se re-sondea en
     cascada 0.7s → 1.6s → 3s → 6s → 12s → 24s y para cuando no encuentra
     nada dos veces seguidas. Presupuesto fijo por pase: coste acotado. */
  const DEEP_STEPS = [700, 1600, 3000, 6000, 12000, 24000];
  let deepStep = 0;
  let deepIdle = 0;
  let deepTimer = null;

  function scheduleDeepScan() {
    if (deepTimer !== null || deepStep >= DEEP_STEPS.length) return;
    deepTimer = setTimeout(() => {
      deepTimer = null;
      if (!effectiveEnabled() || !document.body) { deepIdle = 0; return; }
      const found = deepScan(document.body, DEEP_MAX);
      if (found > 0) {
        deepIdle = 0;
        deepStep = 1;                      // aún hay vida: seguir pronto (fase rápida)
      } else {
        if (++deepIdle >= 2) return;       // nada dos veces: dejar de sondear
        ++deepStep;
      }
      scheduleDeepScan();
    }, DEEP_STEPS[Math.min(deepStep, DEEP_STEPS.length - 1)]);
  }

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
      if (deepTimer !== null) {            // sondeo profundo pendiente: fuera
        clearTimeout(deepTimer);
        deepTimer = null;
      }
      if (autoProbeTimer !== null) {       // sonda pendiente: no desperdiciar
        clearTimeout(autoProbeTimer);
        autoProbeTimer = null;
        --autoProbeCount;                  // devuelve el intento
      }
      if (timer !== null) {                // lote pendiente: cancelado
        clearTimeout(timer);
        timer = null;
        pendingRecords = null;
      }
    } else if (effectiveEnabled()) {
      apply();                               // re-decide (modo auto incluido)
      observe();
      pendingRecords = null;
      deepStep = 0;                          // nueva fase de sondeo al volver
      deepIdle = 0;
      scheduleDeepScan();
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
    autoProbeCount = 0;                    // nueva decisión: presupuesto completo
    apply();
    hookAttachShadow();
    observe();
    if (document.body) {
      scanTree(document.body, BUDGET);
      scheduleDeepScan();
    } else {
      // document_start: el <body> aún no existe; escanear al llegar
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) {
          scanTree(document.body, BUDGET);
          scheduleDeepScan();
        }
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
