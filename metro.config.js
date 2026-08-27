const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);
const rnghLibEntry = path.resolve(
  __dirname,
  'node_modules/react-native-gesture-handler/lib/module/index.js',
);

function debugLog(hypothesisId, message, data) {
  // #region agent log
  fetch('http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '442aa5' },
    body: JSON.stringify({
      sessionId: '442aa5',
      runId: 'post-fix',
      hypothesisId,
      location: 'metro.config.js',
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

debugLog('B', 'metro.config loaded', {
  rnghLibEntry,
  rnghLibExists: fs.existsSync(rnghLibEntry),
});

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-gesture-handler') {
    debugLog('B', 'redirect rngh entry to lib/module', {
      rnghLibEntry,
      exists: fs.existsSync(rnghLibEntry),
    });
    return { type: 'sourceFile', filePath: rnghLibEntry };
  }

  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    const origin = context.originModulePath || '';
    const guessedTs = path.normalize(path.join(path.dirname(origin), `${moduleName}.ts`));
    const canFallback =
      String(moduleName).includes('GestureHandlerRootViewContext') && fs.existsSync(guessedTs);
    debugLog('C', 'metro resolve failed', {
      moduleName,
      origin,
      message: error && error.message,
      guessedTs,
      canFallback,
    });
    if (canFallback) {
      debugLog('C', 'fallback to sibling .ts', { guessedTs });
      return { type: 'sourceFile', filePath: guessedTs };
    }
    throw error;
  }
};

module.exports = config;
