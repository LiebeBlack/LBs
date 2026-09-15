/**
 * ESLint (flat config) sin dependencias extra: solo `eslint`.
 * Cubre los módulos ESM del motor y el script de build (que corre en Node).
 */

const fuente = 'module';
const browserGlobals = {
  browser: 'readonly',
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  console: 'readonly',
  performance: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  requestIdleCallback: 'readonly',
  cancelIdleCallback: 'readonly',
  MutationObserver: 'readonly',
  NodeFilter: 'readonly',
  Node: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  CSSStyleSheet: 'readonly',
  OffscreenCanvas: 'readonly',
  getComputedStyle: 'readonly',
  URL: 'readonly',
  globalThis: 'readonly',
  structuredClone: 'readonly'
};

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  __dirname: 'readonly'
};

const reglasComunes = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-undef': 'error',
  'no-implicit-globals': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'smart'],
  curly: ['error', 'multi-line'],
  'no-console': ['warn', { allow: ['debug', 'error', 'info', 'warn'] }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-extra-semi': 'error',
  'no-irregular-whitespace': 'error',
  'no-unsafe-optional-chaining': 'error',
  'require-atomic-updates': 'error',
  'no-async-promise-executor': 'error',
  'no-await-in-loop': 'off',
  'no-promise-executor-return': 'error',
  'no-return-await': 'error',
  'no-self-compare': 'error',
  'no-template-curly-in-string': 'error',
  'no-throw-literal': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-unreachable-loop': 'error',
  'no-use-before-define': ['error', { functions: false, classes: true, variables: false }],
  'object-shorthand': ['error', 'properties'],
  'prefer-template': 'error',
  'no-multi-spaces': 'error',
  'no-trailing-spaces': 'error',
  'eol-last': ['error', 'always'],
  'semi': ['error', 'always'],
  'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }]
};

export default [
  {
    ignores: ['build/**', 'dist/**', 'node_modules/**', '.tools/**', 'web-ext-lint.json']
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: fuente,
      globals: browserGlobals
    },
    rules: reglasComunes
  },
  {
    // El hook MAIN corre en el mundo de la página: sin APIs de extensión.
    files: ['src/content/hook-main.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { window: 'readonly', Element: 'readonly', document: 'readonly' }
    },
    rules: reglasComunes
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals
    },
    rules: {
      ...reglasComunes,
      // El script de build habla con la terminal: aquí console.log es la salida.
      'no-console': 'off'
    }
  }
];
