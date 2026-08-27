const { getDefaultConfig } = require('expo/metro-config');
const fs = require('node:fs');
const path = require('node:path');
const { resolve } = require('metro-resolver');

const root = process.cwd();
const config = getDefaultConfig(root);
const fromFile = path.join(
  root,
  'node_modules/react-native-gesture-handler/src/components/GestureHandlerRootView.tsx',
);

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

const context = {
  originModulePath: fromFile,
  doesFileExist: exists,
  fileSystemLookup: (file) => {
    try {
      const st = fs.statSync(file);
      return { exists: true, type: st.isDirectory() ? 'd' : 'f', realPath: fs.realpathSync(file) };
    } catch {
      return { exists: false };
    }
  },
  getPackage: (pkgPath) => {
    try {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      return null;
    }
  },
  getPackageForModule: (modulePath) => {
    const pkgRoot = path.join(root, 'node_modules/react-native-gesture-handler');
    return {
      rootPath: pkgRoot,
      packageJson: JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')),
      packageRelativePath: path.relative(pkgRoot, modulePath).replace(/\\/g, '/'),
    };
  },
  redirectModulePath: (modulePath) => modulePath,
  resolveAsset: () => null,
  sourceExts: config.resolver.sourceExts,
  assetExts: config.resolver.assetExts,
  mainFields: config.resolver.resolverMainFields,
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
  unstable_logWarning: () => {},
};

let result = null;
let error = null;
try {
  result = resolve(context, '../GestureHandlerRootViewContext', 'ios');
} catch (e) {
  error = { name: e.name, message: e.message, candidates: e.candidates };
}

const payload = {
  sessionId: '442aa5',
  runId: 'pre-fix',
  hypothesisId: 'C',
  location: 'scripts/debug-metro-relative-resolve.cjs',
  message: 'metro-resolver relative import',
  timestamp: Date.now(),
  data: { result, error, sourceExts: config.resolver.sourceExts },
};
console.log(JSON.stringify(payload, null, 2));
fetch('http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '442aa5' },
  body: JSON.stringify(payload),
}).catch(() => {});
