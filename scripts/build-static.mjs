import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

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
    writeFileSync(join(outDir, '.nojekyll'), '');
    writePrecacheManifest(outDir);
  }
} finally {
  restore();
}

process.exit(status);
