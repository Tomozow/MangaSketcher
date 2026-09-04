import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { SCHEMA_GENERATION, pruneBackups } from './static-host/roots.mjs';

const root = process.cwd();
const parkRoot = join(root, '.static-export-park');
/** @type {{ from: string, to: string }[]} */
const parked = [];

function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) {
    return acc;
  }
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walkFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

function urlsForExportedFile(rel) {
  if (!rel || rel === '.nojekyll' || rel.startsWith('ui-mock/') || rel.endsWith('.txt')) {
    return [];
  }
  if (rel === 'index.html') {
    return ['/'];
  }
  if (rel.endsWith('/index.html')) {
    const dir = `/${rel.slice(0, -'index.html'.length)}`;
    const noSlash = dir.endsWith('/') ? dir.slice(0, -1) : dir;
    return [...new Set([dir, noSlash].filter((item) => item.length > 0))];
  }
  return [`/${rel}`];
}

function posixRel(file, rootDir) {
  return file.slice(rootDir.length).replaceAll('\\', '/').replace(/^\//, '');
}

function writePrecacheManifest(outDir) {
  const urls = new Set();
  for (const file of walkFiles(outDir)) {
    for (const url of urlsForExportedFile(posixRel(file, outDir))) {
      urls.add(url);
    }
  }
  const list = [...urls].sort();
  writeFileSync(join(outDir, 'precache-manifest.json'), `${JSON.stringify(list)}\n`);
}

function stampExportedServiceWorker(outDir) {
  const swPath = join(outDir, 'sw.js');
  if (!existsSync(swPath)) {
    return;
  }
  const stamp = Date.now().toString(36);
  const src = readFileSync(swPath, 'utf8');
  const stamped = src.replace(
    /const SHELL_CACHE = 'mangasketcher-shell-v[^']*'/,
    `const SHELL_CACHE = 'mangasketcher-shell-v13-${stamp}'`,
  );
  writeFileSync(swPath, stamped === src ? `/* build ${stamp} */\n${src}` : stamped);
}

function backupStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${ms}`;
}

function gitShort() {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function writeBuildMeta(outDir) {
  writeFileSync(
    join(outDir, 'build-meta.json'),
    `${JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        git: gitShort(),
        schemaGeneration: SCHEMA_GENERATION,
      },
      null,
      2,
    )}\n`,
  );
}

function writeOutArtifacts(outDir) {
  writeFileSync(join(outDir, '.nojekyll'), '');
  writeFileSync(
    join(outDir, 'serve.json'),
    `${JSON.stringify(
      {
        headers: [
          {
            source: '**/*.html',
            headers: [{ key: 'Cache-Control', value: 'no-store' }],
          },
          {
            source: '**/*.webmanifest',
            headers: [{ key: 'Content-Type', value: 'application/manifest+json; charset=utf-8' }],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writePrecacheManifest(outDir);
  stampExportedServiceWorker(outDir);
  writeBuildMeta(outDir);
}

function backupExistingOut(outDir) {
  if (!existsSync(join(outDir, 'index.html'))) {
    return;
  }
  const stamp = backupStamp();
  let dest = join(root, 'out-backup', stamp);
  let n = 0;
  while (existsSync(dest)) {
    n += 1;
    dest = join(root, 'out-backup', `${stamp}-${n}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(outDir, dest, { recursive: true });
  console.log(`Backed up previous static build to ${dest} (folder name is parkedAt)`);
  pruneBackups(root);
}

/** Next treats custom distDir as the export folder when output is "export". */
function publishExportDir(exportDir, outDir) {
  if (!existsSync(join(exportDir, 'index.html'))) {
    return;
  }
  if (exportDir === outDir) {
    return;
  }
  backupExistingOut(outDir);
  const staging = join(root, '.out-publish-tmp');
  rmSync(staging, { recursive: true, force: true });
  try {
    cpSync(exportDir, staging, { recursive: true });
    writeOutArtifacts(staging);
    rmSync(outDir, { recursive: true, force: true });
    renameSync(staging, outDir);
  } catch (err) {
    if (!existsSync(outDir) && existsSync(staging)) {
      try {
        renameSync(staging, outDir);
      } catch {
        // leave staging for recovery
      }
    }
    throw err;
  }
}

function parkFile(from) {
  const rel = from.slice(root.length + 1);
  const to = join(parkRoot, rel);
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
    rmSync(from);
  }
  parked.push({ from, to });
}

function restore() {
  for (const { from, to } of [...parked].reverse()) {
    mkdirSync(dirname(from), { recursive: true });
    try {
      renameSync(to, from);
    } catch {
      copyFileSync(to, from);
    }
  }
  rmSync(parkRoot, { recursive: true, force: true });
}

rmSync(parkRoot, { recursive: true, force: true });
mkdirSync(parkRoot, { recursive: true });

for (const file of walkFiles(join(root, 'app', 'api'))) {
  if (file.endsWith(`${join('route.ts')}`) || file.endsWith(`${join('route.js')}`)) {
    parkFile(file);
  }
}

let status = 1;
try {
  const result = spawnSync('npx', ['next', 'build'], {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    env: { ...process.env, NEXT_OUTPUT: 'export' },
  });
  status = result.status ?? 1;
  if (status === 0) {
    const outDir = join(root, 'out');
    try {
      publishExportDir(join(root, '.next-export'), outDir);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      status = 1;
    }
  }
} finally {
  restore();
}

process.exit(status);
