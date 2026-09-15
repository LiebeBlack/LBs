# Pure Black Neon v2.6

Tema oscuro **negro #000000** para cualquier web en Firefox, con **dos motores
conmutables** y una estrategia en capas pensada para no destellar en blanco, no
fallar en color y no gastar ciclos de CPU ni memoria.

- **Motor de inversión** (por defecto): invierte el documento y **re-invierte la
  media** para que imágenes, vídeos, canvas e iframes conserven sus colores
  originales.
- **Motor AMOLED por selectores**: el clásico, sin invertir nada, con negro puro
  estricto en el árbol estructural y acentos neón literales.

Compatibilidad: **Firefox 155+** en escritorio y **Firefox para Android 155+**.
Atajo: `Ctrl+Shift+L` (`⌘⇧L` en macOS).

---

## Estrategia en capas

```
CAPA 3  Correcciones de color (marcas [data-pbn-*])        ← sabe qué falla
CAPA 2  Advanced Smart Correction (JS presupuestado)       ← solo marca atributos
CAPA 1  Motor visual: CSS puro                             ← pinta el 100 % del tema
CAPA 0  Contrato de arranque                               ← garantiza el primer pintado
```

**La regla que gobierna el diseño:** la capa superior nunca puede degradar a la
inferior. La Capa 1 pinta el tema completa y correcta por sí sola; la Capa 2 solo
añade precisión sobre nodos concretos, con presupuesto medible y apagado de
emergencia.

### Capa 0 — cero destellos blancos

El CSS se inyecta desde el manifest en `document_start`, y el motor está activo
**por defecto en CSS**: no depende de ninguna lectura asíncrona. El JS solo
escribe *anulaciones* (`data-pbn-off`) cuando la extensión está desactivada, el
sitio está excluido o Auto detecta un sitio ya oscuro.

Prohibiciones deliberadas: nunca `visibility:hidden` transitorios, nunca
`filter` en `<body>` (solo en `<html>`, que la especificación de Filter Effects
exime de crear containing block para descendientes `position:fixed` — así las
cabeceras fijas y sticky siguen funcionando), nunca `will-change` y ninguna
lectura de layout en el arranque.

### Capa 1 — motor visual (CSS puro)

**Inversión** (`src/engines/invert.css`):

```css
html[data-pbn-engine="invert"]:not([data-pbn-off]) {
  filter: invert(100%) hue-rotate(180deg) !important;   /* 1 sola capa de composición */
}
/* re-inversión con ORDEN INVERTIDO: cancelación exacta */
html[...] :is(img, video, canvas, iframe, embed, object, picture, [data-pbn-media]) {
  filter: hue-rotate(180deg) invert(100%) !important;
}
```

El filtro del documento es `F = H ∘ I` (primero `invert`, después `hue-rotate`).
Re-invirtiendo con el orden opuesto `G = I ∘ H` se cumple
`F(G(x)) = H(I(I(H(x)))) = H(H(x)) = x`: **cancela exactamente**. Con el mismo
orden que el padre quedaría un residuo por la no conmutatividad de `invert` y
`hue-rotate`. El mismo razonamiento vale para el atenuado opcional de media: las
funciones de `brightness/contrast` van *delante* de la cadena para que el
resultado neto sea exactamente ese atenuado sobre la imagen original.

Detalles que importan:

- **Negro `#000000` garantizado** por un respaldo `html::before` fijo que cubre el
  viewport (blanco pre-inversión → negro exacto, porque los neutros son
  invariantes bajo `hue-rotate(180deg)`). No se fuerza el fondo de `html`/`body`
  mientras se mide, para no enmascarar el color real que lee el modo Auto.
- **`color-scheme: light`**: cualquier widget que el navegador pintara oscuro se
  invertiría a claro. Forzando claro, controles y caret quedan oscuros tras la
  inversión.
- **SVG inline NO se re-invierte**: si se re-invirtiera, los iconos
  `fill: currentColor` volverían a su color original (oscuro) sobre un fondo ya
  negro y desaparecerían.
- **Media protegida**: `img`, `picture`, `video`, `canvas`, `iframe`, `embed`,
  `object` y los fondos con imagen vuelven a su color original. Dentro de un
  bloque ya re-invertido no se re-invierte nada más (se cancelarían entre sí).
- **Acentos mínimos** (solo foco, selección, caret y scrollbar) con una paleta
  pre-invertida. Un neón 100 % saturado no es alcanzable por el pipeline
  `invert + hue-rotate`: el neón literal está en el motor AMOLED.
- **Salvaguardas**: `@media print` desactiva la inversión (nunca imprimir en
  negativo) y `@media (forced-colors: active)` respeta el alto contraste del
  sistema.

**AMOLED por selectores** (`src/engines/amoled.css`): negro puro en el árbol
estructural, texto claro, controles y autofill oscurecidos, acentos neón
literales, capas superiores (`dialog`, `popover`) y `@media print` en claro.

### Capa 2 — Advanced Smart Correction (JS con presupuesto)

El JS **no pinta nada**: solo escribe atributos; el CSS renderiza la corrección.
Eso lo hace idempotente, reversible (`resetCorrections()`) y auditable.

| Parámetro | Valor |
|---|---|
| Rebanada de tiempo por tarea | 8 ms |
| Programación | `requestIdleCallback` (fallback `setTimeout`) |
| Nodos visitados por tarea | 2000 (400 en submarcos, 800 si el DOM pasa de 20 000 nodos) |
| Presupuesto total de CPU | 40 ms por página; al agotarse, la capa 2 se apaga sola (se recuperan hasta 3 recargas al volver de una pestaña oculta) |
| Observador | uno solo, coalescido a 150 ms, lote máximo de 400 nodos |
| Pausa | `visibilitychange` → desconexión total; 0 % de CPU en pestañas ocultas |
| Memoria | colas acotadas, `Set` por lote, sin retención tras el teardown |

Pases: **A** (atributo `style`, sin layout) → **B** (estilos computados, una sola
llamada a `getComputedStyle` por nodo, con `checkVisibility()`) → lote de
mutaciones para contenido dinámico. Cada nodo cede el control, así que el corte
por tiempo es real y el trabajo se reanuda en el siguiente hueco de inactividad.

El modo Auto **mide una sola vez** (como máximo 2 lecturas de estilo en 2 fases,
4 en total contando la confirmación) y nunca recorre el DOM.

### Capa 3 — matriz de fallos de color

| Modo de fallo | Motor | Corrección |
|---|---|---|
| Foto como `background-image` (por clase o inline) | inversión | `[data-pbn-media]` re-invertido |
| `img/video/canvas/iframe/embed/object/picture` | inversión | re-inversión de orden invertido |
| Iconos `fill: currentColor` | inversión | SVG inline sin re-invertir |
| `filter` del sitio (invert/brightness/sepia…) | inversión | `[data-pbn-filterreset]` |
| `mix-blend-mode` dependiente del fondo | inversión | `[data-pbn-blend]` |
| `backdrop-filter` (glassmorphism) | inversión | `[data-pbn-backdrop]` |
| Texto oscuro fijado por clases CSS | AMOLED | `[data-pbn-fix2]` |
| Texto casi invisible inline | AMOLED | `[data-pbn-fix]` |
| Texto recortado sobre gradiente | AMOLED | `[data-pbn-grad]` |
| Bloque claro | AMOLED | `[data-pbn-bg]` |
| Icono SVG con relleno oscuro explícito | AMOLED | `[data-pbn-svg]` |
| Sombras claras (halos sobre negro) | AMOLED | `[data-pbn-flat]` |
| Contenido dentro de shadow DOM | AMOLED | hook MAIN + hoja adoptable compartida |
| Impresión y alto contraste | ambos | el filtro se desactiva |

**Degradación elegante**: si se agota el presupuesto, el resultado es "sitio
oscuro con alguna foto invertida", nunca "página congelada".

---

## Instalación

El código fuente son módulos ES y hojas en `src/`; lo que se carga en Firefox es
el directorio **`build/`**, generado por esbuild (Node ≥ 20).

```bash
npm install
npm run build          # genera build/ (código + manifest + CSS + assets)
```

| Opción | Cómo |
|---|---|
| Temporal (desarrollo) | `about:debugging#/runtime/this-firefox` → *Cargar complemento temporal…* → `build/manifest.json` |
| Con web-ext | `npm run start` (hace build y lanza Firefox) |
| Empaquetar | `npm run package` (deja el `.zip`/`.xpi` en `dist/`) |

El script de build **valida** que todos los archivos que menciona el manifest
existen en `build/`, así que una ruta rota se detecta sin abrir el navegador.

## Desarrollo

```bash
npm run watch       # rebuild incremental de build/
npm run lint        # ESLint (flat config)
npm run lint:addons # web-ext lint sobre build/
npm run clean       # borra build/
```

`build/` y `dist/` están en `.gitignore`: nunca se commitean artefactos.

El workflow `.github/workflows/package.yml` instala dependencias, pasa ESLint,
hace el build, ejecuta `web-ext lint`, empaqueta el `.xpi` sobre `build/` y lo
adjunta como artifact (y al release, en cada push a `main` o en un tag `v*`).

## Uso

- Popup: interruptor global, motor (Inversión / AMOLED), modo (Auto / Siempre),
  AMOLED estricto, modo eco, congelar animaciones, atenuar media, acento,
  exclusión por sitio, valores por defecto y estado de la pestaña actual.
- Atajo `Ctrl+Shift+L`: alterna el tema **solo en esa pestaña** (el override vive
  en `storage.session`, así que los iframes que se crean después lo heredan).
- El badge muestra `OFF` cuando el motor no está aplicado y se limpia al empezar
  una navegación.

## Permisos

- `storage`: guardar preferencias (sincronizadas) y el override por pestaña
  (sesión).
- `activeTab`: solo para el respaldo del host del popup; se concede al pulsar el
  icono.

Ni `tabs`, ni `host_permissions`, ni `scripting`. El badge ya no lee `tab.url`
(que Firefox solo entrega con `tabs` o permiso de host): el estado lo reporta el
propio content script, que conoce su host.

## Estructura

| Archivo | Rol |
|---|---|
| `manifest.json` | MV3: ambas hojas CSS en `document_start`, hook MAIN declarativo |
| `src/engines/invert.css` | Capa 1A: motor de inversión con re-inversión exacta |
| `src/engines/amoled.css` | Capa 1B: motor por selectores |
| `src/content/entry.js` | Capa 0 + orquestación de la Capa 2 |
| `src/content/engine.js` | Escribe los atributos del motor en `<html>` |
| `src/content/autodetect.js` | Auto con presupuesto (2 fases, sin recorrer el DOM) |
| `src/content/marks.js` | Registro de marcas y utilidades del DOM |
| `src/content/scheduler.js` | Gobernador de presupuesto (rebanadas de 8 ms, tope de 40 ms) |
| `src/content/observe.js` | Único `MutationObserver` coalescido |
| `src/content/passes/` | Pases A/B y correcciones por motor |
| `src/content/shadow.js` | Hoja adoptable compartida para shadow roots |
| `src/content/hook-main.js` | Hook `attachShadow` en el mundo de la página (15 líneas) |
| `src/background/` | Badge reportado + atajo + ciclo de vida del event page |
| `src/popup/` | Ajustes en vivo, accesibles y con acuse de guardado |
| `src/shared/` | Estado único, mensajería validada, color y registro |
| `scripts/build.mjs` | esbuild IIFE por entrada + copia de assets + validación |

## Límites conocidos (honestos)

1. **Fotos de fondo con `background-size: auto`** no se rescatan: la detección
   deliberada usa `background-size` (cover/contain/medida explícita) para no leer
   geometría. Los fondos inline siempre se rescatan.
2. **Fondos con foto en `html`/`body`**: en modo AMOLED estricto se eliminan; en
   modo de inversión no se pueden re-invertir sin cancelar la página entera, así
   que el lienzo negro los tapa.
3. **Desplegables nativos** (`<select>`, selector de fecha): son UI del navegador,
   no se invierten y quedan claros en el motor de inversión. En el motor AMOLED sí
   se oscurecen (ahí `color-scheme: dark`).
4. **Emoji**: su tono se desplaza ligeramente al invertir; es intrínseco al
   pipeline `invert + hue-rotate`.
5. **Shadow DOM en AMOLED**: se viste con el hook MAIN; si un sitio bloquea el
   prototipo, solo se alcanzan las raíces ya conocidas.
6. El hook MAIN patchea `Element.prototype.attachShadow` en el mundo de la página:
   es visible y detectable por el sitio (consecuencia inevitable de ser inmune a
   la CSP).
7. **`strict_min_version: 155.0`** (tu valor declarado). Todos los APIs usados
   existen desde Firefox 128, así que bajarlo a `128.0` es un cambio de una línea
   si algún día quieres cubrir ESR/Android antiguos.
