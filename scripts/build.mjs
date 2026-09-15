/**
 * Build de Pure Black Neon.
 *
 *   node scripts/build.mjs            → build/ completo (código + assets)
 *   node scripts/build.mjs --watch    → rebuild incremental mientras se edita
 *   node scripts/build.mjs --clean    → borra build/
 *
 * Empaqueta cada entrada ESM del motor a un IIFE clásico (los content scripts
 * no admiten módulos) y copia manifest/CSS/HTML/SVG a build/, que es la
 * extensión real que se carga en Firefox y se empaqueta como .xpi.
 * Al terminar valida que todos los archivos que menciona el manifest existen:
 * eso detecta rutas rotas sin necesidad de abrir el navegador.
 */

import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const salida = path.join(raiz, 'build');
const args = new Set(process.argv.slice(2));

/** Entradas → nombres finales que espera manifest.json. */
const ENTRADAS = {
  content: 'src/content/entry.js',
  'hook-main': 'src/content/hook-main.js',
  background: 'src/background/entry.js',
  popup: 'src/popup/entry.js'
};

/** Assets que se copian tal cual (y las hojas del motor, que viven en src/). */
const COPIAS = [
  ['manifest.json', 'manifest.json'],
  ['popup.html', 'popup.html'],
  ['popup.css', 'popup.css'],
  ['icon.svg', 'icon.svg'],
  ['src/engines/invert.css', 'invert.css'],
  ['src/engines/amoled.css', 'amoled.css']
];

const opcionesEsbuild = {
  entryPoints: Object.fromEntries(
    Object.entries(ENTRADAS).map(([nombre, ruta]) => [nombre, path.join(raiz, ruta)])
  ),
  outdir: salida,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  charset: 'utf8',
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  treeShaking: true,
  logLevel: 'info'
};

async function existe(ruta) {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

async function copiarAssets() {
  await mkdir(salida, { recursive: true });
  for (const [origen, destino] of COPIAS) {
    await cp(path.join(raiz, origen), path.join(salida, destino));
  }
}

/** Comprueba que el manifest no apunte a archivos inexistentes en build/. */
async function verificarSalida() {
  const manifest = JSON.parse(await readFile(path.join(salida, 'manifest.json'), 'utf8'));
  const referencias = [
    manifest.action?.default_popup,
    manifest.action?.default_icon,
    ...Object.values(manifest.icons ?? {}),
    ...(manifest.content_scripts ?? []).flatMap((bloque) => [...(bloque.js ?? []), ...(bloque.css ?? [])]),
    ...(manifest.background?.scripts ?? []),
    ...(manifest.background?.service_worker ? [manifest.background.service_worker] : [])
  ].filter((valor) => typeof valor === 'string');

  const faltan = [];
  for (const referencia of new Set(referencias)) {
    if (!(await existe(path.join(salida, referencia)))) faltan.push(referencia);
  }
  if (faltan.length > 0) {
    throw new Error(`manifest.json referencia archivos que no existen en build/: ${faltan.join(', ')}`);
  }
  return [...new Set(referencias)].length;
}

async function principal() {
  if (args.has('--clean')) {
    await rm(salida, { recursive: true, force: true });
    console.log('PBN: build/ eliminado.');
    return;
  }

  await copiarAssets();

  if (args.has('--watch')) {
    const contexto = await esbuild.context(opcionesEsbuild);
    await contexto.rebuild(); // primer build explícito: la validación no depende del orden de watch()
    await contexto.watch();
    const total = await verificarSalida();
    console.log(`PBN: observando cambios · ${total} referencias del manifest verificadas en build/`);
    return;
  }

  await esbuild.build(opcionesEsbuild);
  const total = await verificarSalida();
  console.log(`PBN: build listo en build/ · ${total} referencias del manifest verificadas.`);
}

principal().catch((err) => {
  console.error('PBN: el build falló.');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
