import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgRoot = path.join(root, 'node_modules', 'react-native-gesture-handler');
const fromFile = path.join(pkgRoot, 'src', 'components', 'GestureHandlerRootView.tsx');
const candidates = [
  'GestureHandlerRootViewContext.ts',
  'GestureHandlerRootViewContext.tsx',
  'GestureHandlerRootViewContext.js',
  'GestureHandlerRootViewContext.ios.ts',
  'GestureHandlerRootViewContext.native.ts',
];

const pkg = require(path.join(pkgRoot, 'package.json'));
const existence = Object.fromEntries(
  candidates.map((name) => {
    const full = path.join(pkgRoot, 'src', name);
    return [name, { exists: existsSync(full), full }];
  }),
);

let metroResult = null;
let metroError = null;
try {
  const { resolve } = require('metro-resolver');
  metroResult = resolve(
    {
      originModulePath: fromFile,
      sourceExts: ['ts', 'tsx', 'js', 'jsx', 'json'],
      mainFields: ['react-native', 'browser', 'main'],
      allowHaste: false,
      nodeModulesPaths: [path.join(root, 'node_modules')],
      extraNodeModules: {},
      originPackagePath: pkgRoot,
      resolveRequest: null,
    },
    '../GestureHandlerRootViewContext',
    'ios',
  );
} catch (error) {
  metroError = {
    name: error?.name,
    message: error?.message,
    code: error?.code,
  };
}

const payload = {
  sessionId: '442aa5',
  runId: 'pre-fix',
  hypothesisId: 'A-E',
  location: 'scripts/debug-rngh-resolve.mjs',
  message: 'RNGH context resolve probe',
  timestamp: Date.now(),
  data: {
    rnghVersion: pkg.version,
    reactNativeField: pkg['react-native'],
    main: pkg.main,
    module: pkg.module,
    fromFileExists: existsSync(fromFile),
    contextTsExists: existsSync(path.join(pkgRoot, 'src', 'GestureHandlerRootViewContext.ts')),
    libContextExists: existsSync(path.join(pkgRoot, 'lib', 'module', 'GestureHandlerRootViewContext.js')),
    existence,
    metroResult,
    metroError,
    platform: process.platform,
  },
};

console.log(JSON.stringify(payload, null, 2));

await fetch('http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '442aa5' },
  body: JSON.stringify(payload),
}).catch((err) => {
  console.error('ingest failed', err.message);
});
