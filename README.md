# Pure Black Neon v2.2

Modo oscuro **puro (#000000)** con acentos neón para **cualquier sitio web** en Firefox.
Sin librerías, sin telemetría, sin errores de renderizado.

**Compatibilidad:** Firefox 155+ en escritorio y **Firefox para Android 155+**
(gecko_android declarado). Atajo: `Ctrl+Shift+L` (Windows/Linux) · `Cmd+Shift+L` (macOS).

## Características

- **Negro puro #000000** en todo el árbol del DOM, con texto gris legible (contraste AA).
- **Modo Auto (por defecto)**: mide la luminancia real del fondo del sitio; si ya es oscuro no lo toca (cero atributos, cero coste), si es claro actúa en Forzado.
- **4 niveles de fuerza**: Auto, Base, Forzado (aplasta componentes con fondos complejos, rellena texto con gradiente que sería invisible) y Turbo (neutraliza además filtros, opacidades y blur).
- **Acentos neón** configurables: Multicolor (verde/cian/magenta), Verde, Cian o Magenta.
- **Análisis inteligente de estilos inline**: detecta texto invisible y bloques claros mediante luminancia WCAG, sin mutar el CSS del sitio.
- **Shadow DOM abierto**: se viste automáticamente; hook MAIN-world de `attachShadow` vía `contentScripts.register` (inmune a CSP) con fallback inline.
- **Manejo de contenido dinámico**: `MutationObserver` con debounce de 120 ms y presupuesto de 400 nodos por lote; se **pausa por completo** en pestañas ocultas (0 % CPU en segundo plano).
- **Atajo de teclado**: `Ctrl+Shift+L` alterna el modo solo en la pestaña actual.
- **Exclusiones por sitio** y ajustes en vivo desde el popup (sin recargar páginas).
- Respeta `prefers-reduced-motion` y nunca imprime en negro (`@media print`).

## Instalación (Firefox)

### Opción A — temporal (desarrollo)

1. Abre `about:debugging#/runtime/this-firefox`
2. Clic en **«Cargar complemento temporal…»**
3. Selecciona el archivo `manifest.json` de esta carpeta.

### Opción B — web-ext (recomendada para probar)

```bash
npm install -g web-ext
web-ext run -p firefox
```

### Opción C — empaquetar como .xpi

```bash
zip -r ../pure-black-neon.xpi . -x '.*'
```

Luego en `about:addons` → engranaje → **«Instalar complemento desde archivo…»**
(requiere firma de Mozilla para uso permanente, o Firefox Developer Edition / ESR con `xpinstall.signatures.required = false`).

## Uso

- Popup del icono: interruptor global, modo de fuerza, acento, extras y **«Excluir este sitio»**.
- Atajo: `Ctrl+Shift+L` por pestaña.
- Los cambios se aplican al instante en todas las pestañas abiertas (vía `storage.onChanged`).

## Empaquetado automático (GitHub Actions)

El workflow `.github/workflows/package.yml` en cada push/PR:

1. Ejecuta `web-ext lint` y muestra el resumen de errores/avisos.
2. Empaqueta el `.xpi` con `web-ext build`.
3. Lo sube como **artifact** descargable (`pure-black-neon-xpi`).
4. Si el push es un **tag** (`git tag v2.1.0 && git push --tags`), adjunta el `.xpi` a la GitHub Release.

## Arquitectura

| Archivo        | Rol                                                          |
|----------------|--------------------------------------------------------------|
| `manifest.json`| MV3 Firefox, `content_scripts` con CSS+JS en `document_start`|
| `dark.css`     | Todo el trabajo visual, condicionado a `html[data-pbn]`      |
| `content.js`   | Estado + análisis inline + Shadow DOM + MutationObserver     |
| `background.js`| Badge ON/OFF + atajo de teclado (evento, no persistente)     |
| `popup.*`      | Ajustes en vivo (storage.sync)                               |

El truco de rendimiento: **el CSS hace el 95 % del trabajo** declarado en el manifest,
y el toggle se reduce a un atributo en `<html>`. El JS solo vigila nodos nuevos con
presupuesto estricto y pausa el observer cuando la pestaña no es visible.

## Permisos

- `storage`: guardar tus preferencias (sincronizadas entre dispositivos).
- `<all_urls>` (content scripts): necesario para estilizar cualquier página. No se envía ningún dato a ningún servidor.
