# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## 2.6.1 — 2026-09-15

### Añadido
- **UI renovada**: popup más ancho (348 px, adaptable a pantallas móviles), controles más grandes con zonas táctiles de 34–44 px, secciones tipo tarjeta, brillos neón en el logotipo, interruptor y selección con glow, y soporte de `prefers-reduced-motion`.
- **Página de opciones de tamaño completo** (`options.html`, abrible desde "Ajustes completos…" en el popup y desde about:addons), que comparte estilos con el popup.
- Chip de versión en el popup y en las opciones, leído del manifest para que nunca se desincronice.

### Corregido

**Texto invisible (negro sobre negro)**
- La capa de correcciones ya no se apaga para siempre al agotarse su presupuesto de CPU (40 ms): pausa de 3 s y reanudación **retomando el recorrido donde se cortó** (antes se descartaba el generador y un barrido nuevo siempre empezaba de cero).
- El primer barrido ya no se pierde cuando el arranque ocurre sin `<body>` (páginas estáticas quedaban con texto oscuro sin rescatar).
- Al volver a una pestaña visible (o desde el bfcache) se reaplica el estado y se lanza barrido: lo mutado mientras estaba oculta ya se corrige.
- Cambiar de motor en vivo (Inversión ↔ AMOLED) lanza su propio barrido: el contenido dependiente del motor nuevo ya no queda a medias hasta la próxima mutación.
- Presupuestos ampliados: 4000/800 nodos (principal/submarco) y 1500 en DOM enormes, con corte real por tiempo y salvaguarda de 150 000 nodos por recorrido.

**Imágenes y elementos rotos**
- `<picture>` ya no lleva filtro en el motor de inversión: el contenedor anulaba en cadena la re-inversión del `<img>` hijo y las fotos volvían al negativo.
- Los gradientes inline dejan de re-invertirse por la sola presencia de `style` (botones y banners deliberados se veían como bloques claros); el rescate lo decide la capa JS solo para fotos con tamaño explícito.
- `dimmedia` ya no atenuía dos veces las imágenes dentro de `<picture>`.
- Fondos declarados en declaraciones separadas (`background-image` + `background-size: cover`) ya se rescatan en el pase barato (la URL puede vivir en otra declaración del mismo atributo).

**Comportamiento errático**
- Los listeners de mensajes se re-registran al volver del bfcache: el atajo `Ctrl+Shift+L` y el popup volvían a no afectar a la pestaña tras atrás/adelante.
- El modo eco limpia las correcciones ya aplicadas (antes la capa 2 "apagada" seguía teniendo efecto visual).
- El trabajo rechazado durante las pausas del gobernador se recupera con un barrido posterior (nada queda sin corregir por una ráfaga de mutaciones).
- Popup: el tooltip del host ahora se actualiza en cada render (antes se quedaba con el valor previo a resolver el host).
- `scripts/webext-report.mjs`: un informe JSON no-objeto ya no se cuenta como "0 hallazgos".

### Documentación
- README sincronizado con los parámetros reales del gobernador de presupuesto.
