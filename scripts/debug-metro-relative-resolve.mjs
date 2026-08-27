import { getDefaultConfig } from 'expo/metro-config';
import path from 'node:path';

const root = process.cwd();
const config = getDefaultConfig(root);
const fromFile = path.join(
  root,
  'node_modules/react-native-gesture-handler/src/components/GestureHandlerRootView.tsx',
);

const context = {
  ...config.resolver,
  originModulePath: fromFile,
  doesFileExist: (file) => {
    try {
      return require('node:fs').existsSync(file);
    } catch {
      return false;
    }
  },
  fileSystemLookup: (file) => {
    const fs = require('node:fs');
    try {
      const st = fs.statSync(file);
      return { exists: true, type: st.isDirectory() ? 'd' : 'f', realPath: file };
    } catch {
      return { exists: false };
    }
  },
  getPackage: (pkgPath) => {
    try {
      return require(pkgPath);
    } catch {
      return null;
    }
  },
  getPackageForModule: (modulePath) => {
    const pkgRoot = path.join(root, 'node_modules/react-native-gesture-handler');
    return {
      rootPath: pkgRoot,
      packageJson: require(path.join(pkgRoot, 'package.json')),
      packageRelativePath: path.relative(pkgRoot, modulePath).replace(/\\/g, '/'),
    };
  },
  redirectModulePath: (modulePath) => modulePath,
  resolveAsset: () => null,
  sourceExts: config.resolver.sourceExts,
  allowHaste: false,
  disableHierarchicalLookup: false,
  extraNodeModules: {},
  originPackagePath: path.join(root, 'node_modules/react-native-gesture-handler'),
  nodeModulesPaths: [path.join(root, 'node_modules')],
  preferNativePlatform: true,
  resolveRequest: null,
  unstable_enablePackageExports: config.resolver.unstable_enablePackageExports,
  unstable_conditionNames: config.resolver.unstable_conditionNames ?? [],
  unstable_conditionsByPlatform: config.resolver.unstable_conditionsByPlatform ?? {},
};

let result = null;
let error = null;
try {
  const resolve = require('metro-resolver').resolve;
  result = resolve(context, '../GestureHandlerRootViewContext', 'ios');
} catch (e) {
  error = { name: e.name, message: e.message, candidates: e.candidates, stack: String(e.stack).slice(0, 1500) };
}

const payload = {
  sessionId: '442aa5',
  runId: 'pre-fix',
  hypothesisId: 'C',
  location: 'scripts/debug-metro-relative-resolve.mjs',
  message: 'metro-resolver relative import',
  timestamp: Date.now(),
  data: { result, error, sourceExts: config.resolver.sourceExts },
};
console.log(JSON.stringify(payload, null, 2));
await fetch('http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '442aa5' },
  body: JSON.stringify(payload),
}).catch(() => {});
