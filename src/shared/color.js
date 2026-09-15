/* ============================================================================
   Color: normalización y luminancia SIN escribir un parser de CSS Color 4.

   El navegador ya sabe interpretar `rgb()`, `oklch()`, `lab()`, `color-mix()`
   y todo lo demás; el canvas normaliza cualquiera de esas sintaxis a un valor
   sRGB, así que obtenemos soporte total de color moderno con ~20 líneas y sin
   mantener una tabla de conversiones.
   ============================================================================ */

const CENTINELA = '#010203';
const RE_NUMEROS = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

let contexto = null;

function obtenerContexto() {
  if (contexto) return contexto;
  try {
    if (typeof OffscreenCanvas === 'function') {
      contexto = new OffscreenCanvas(1, 1).getContext('2d');
    } else if (typeof document !== 'undefined' && document.createElement) {
      const lienzo = document.createElement('canvas');
      lienzo.width = 1;
      lienzo.height = 1;
      contexto = lienzo.getContext('2d');
    }
  } catch {
    contexto = null;
  }
  return contexto;
}

/** Libera el contexto 2D (memoria de GPU) cuando ya no se va a medir más. */
export function releaseColorContext() {
  contexto = null;
}

function numeros(valor) {
  return (valor.match(RE_NUMEROS) ?? []).map(Number);
}

function limitar(valor, minimo, maximo) {
  if (!Number.isFinite(valor)) return minimo;
  return Math.min(maximo, Math.max(minimo, valor));
}

function desdeHex(hex) {
  const limpio = hex.replace('#', '');
  const largo = limpio.length;
  if (largo !== 3 && largo !== 4 && largo !== 6 && largo !== 8) return null;

  const trozo = (indice, tamano) => {
    const parte = tamano === 1 ? limpio[indice] + limpio[indice] : limpio.slice(indice, indice + 2);
    return parseInt(parte, 16);
  };

  if (largo === 3 || largo === 4) {
    return {
      r: trozo(0, 1),
      g: trozo(1, 1),
      b: trozo(2, 1),
      a: largo === 4 ? trozo(3, 1) / 255 : 1
    };
  }
  return {
    r: trozo(0, 2),
    g: trozo(2, 2),
    b: trozo(4, 2),
    a: largo === 8 ? trozo(6, 2) / 255 : 1
  };
}

function desdeCanonico(valor) {
  if (valor.startsWith('#')) return desdeHex(valor);

  const baja = valor.toLowerCase();
  const lista = numeros(valor);
  if (lista.length < 3) return null;

  // `color(srgb r g b / a)`: componentes en 0..1
  if (baja.startsWith('color(')) {
    return {
      r: limitar(lista[0] * 255, 0, 255),
      g: limitar(lista[1] * 255, 0, 255),
      b: limitar(lista[2] * 255, 0, 255),
      a: limitar(lista[3] ?? 1, 0, 1)
    };
  }

  // `rgb(r, g, b)` / `rgba(r, g, b, a)`
  return {
    r: limitar(lista[0], 0, 255),
    g: limitar(lista[1], 0, 255),
    b: limitar(lista[2], 0, 255),
    a: limitar(lista[3] ?? 1, 0, 1)
  };
}

/**
 * Convierte cualquier color CSS a sRGB. Devuelve null si el navegador no lo
 * entiende, en cuyo caso el llamante debe tratarlo como "indeciso" (nunca como
 * negro ni como blanco).
 */
export function toRgb(color) {
  if (typeof color !== 'string' || color.length === 0) return null;
  const ctx = obtenerContexto();
  if (!ctx) return null;

  try {
    ctx.fillStyle = CENTINELA;
    ctx.fillStyle = color;
    const canonico = String(ctx.fillStyle);
    if (canonico === CENTINELA && color.trim().toUpperCase() !== CENTINELA) return null;
    return desdeCanonico(canonico);
  } catch {
    return null;
  }
}

/** Luminancia relativa WCAG (0 = negro, 1 = blanco). */
export function luminance(color) {
  const lineal = (v) => {
    const normalizado = limitar(v, 0, 255) / 255;
    return normalizado <= 0.04045 ? normalizado / 12.92 : Math.pow((normalizado + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lineal(color.r) + 0.7152 * lineal(color.g) + 0.0722 * lineal(color.b);
}

/** Luminancia efectiva suponiendo un fondo blanco (peor caso para Auto). */
export function luminanceOverWhite(color) {
  const alfa = limitar(color.a, 0, 1);
  return alfa * luminance(color) + (1 - alfa) * 1;
}

/** Luminancia efectiva sobre un fondo ya oscuro (para detectar texto invisible). */
export function luminanceOverBlack(color) {
  return limitar(color.a, 0, 1) * luminance(color);
}

/** Desviación máxima de canal: 0 = gris neutro, alto = color cromático. */
export function chroma(color) {
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
}
