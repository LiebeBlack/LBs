/**
 * Lee el informe de `web-ext lint` (web-ext-lint.json) y lo resume.
 *
 *   node scripts/webext-report.mjs            → una línea con el recuento
 *   node scripts/webext-report.mjs --row      → fila de tabla Markdown
 *   node scripts/webext-report.mjs --detail   → sección Markdown con el detalle
 *
 * Nunca falla ni sale con código distinto de 0: el informe puede no existir, o
 * llevar basura delante del JSON (el banner de npm, por ejemplo). En esos casos
 * lo dice y termina bien, para que un informe ilegible no tumbe el job del CI.
 */

import { readFileSync } from 'node:fs';

const RUTA_POR_DEFECTO = 'web-ext-lint.json';

/** Un argumento posicional es la ruta del informe; los `--flags`, el formato. */
function analizarArgumentos(argumentos) {
  const modo = argumentos.includes('--detail')
    ? 'detail'
    : argumentos.includes('--row')
      ? 'row'
      : 'line';
  const ruta = argumentos.find((valor) => !valor.startsWith('--')) ?? RUTA_POR_DEFECTO;
  return { modo, ruta };
}

const { modo, ruta } = analizarArgumentos(process.argv.slice(2));

/** Acepta también informes con texto delante del objeto JSON (se busca el `{`). */
function aInforme(texto) {
  const desde = texto.indexOf('{');
  if (desde < 0) return null;

  let datos;
  try {
    datos = JSON.parse(desde === 0 ? texto : texto.slice(desde));
  } catch {
    return null;
  }
  if (typeof datos !== 'object' || datos === null) return null;

  return {
    estado: 'ok',
    errores: Array.isArray(datos.errors) ? datos.errors : [],
    avisos: Array.isArray(datos.warnings) ? datos.warnings : []
  };
}

function leerInforme(archivo) {
  try {
    const texto = readFileSync(archivo, 'utf8');
    if (texto.trim() === '') return { estado: 'ausente' };
    return aInforme(texto) ?? { estado: 'ilegible' };
  } catch {
    return { estado: 'ausente' };
  }
}

const informe = leerInforme(ruta);
const motivos = {
  ausente: 'sin informe (el lint no se ejecutó)',
  ilegible: 'informe ilegible (no contiene JSON válido)'
};

/** web-ext expone el código de regla como `code`, pero serializado aparece `_code`. */
function codigoDe(item) {
  const codigo = item?.code ?? item?._code;
  return typeof codigo === 'string' && codigo ? codigo : 'sin-código';
}

function recuento() {
  return `${informe.errores.length} errores, ${informe.avisos.length} avisos`;
}

function imprimirLinea() {
  console.log(informe.estado === 'ok' ? `web-ext lint: ${recuento()}` : `web-ext lint: ${motivos[informe.estado]}`);
}

function imprimirFila() {
  console.log(`| **web-ext lint** | ${informe.estado === 'ok' ? recuento() : 'sin informe válido'} |`);
}

function imprimirDetalle() {
  if (informe.estado !== 'ok') {
    console.log(motivos[informe.estado]);
    return;
  }

  const items = [
    ...informe.errores.map((item) => ({ item, severidad: 'error' })),
    ...informe.avisos.map((item) => ({ item, severidad: 'aviso' }))
  ];
  if (items.length === 0) {
    console.log('Sin hallazgos de web-ext lint.');
    return;
  }

  console.log('');
  console.log('### Detalle del lint');
  console.log('');
  for (const { item, severidad } of items) {
    const mensaje = typeof item?.message === 'string' ? item.message : '';
    const archivo = typeof item?.file === 'string' ? item.file : '';
    const linea = Number.isInteger(item?.line) ? `:${item.line}` : '';
    console.log(`- [${severidad}] ${codigoDe(item)} — ${mensaje}`.trimEnd());
    if (archivo) console.log(`  - archivo: \`${archivo}${linea}\``);
  }
}

if (modo === 'row') imprimirFila();
else if (modo === 'detail') imprimirDetalle();
else imprimirLinea();
