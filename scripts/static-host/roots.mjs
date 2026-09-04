import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const BACKUP_KEEP = 10;
export const SCHEMA_GENERATION = 1;

export function isCompleteStaticRoot(dir) {
  return existsSync(join(dir, 'index.html'));
}

export function readBuildMeta(dir) {
  const path = join(dir, 'build-meta.json');
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function listStaticRoots(repoRoot) {
  /** @type {{ id: string, abs: string, label: string, parkedAt: string | null, meta: object | null }[]} */
  const items = [];
  const outDir = join(repoRoot, 'out');
  if (isCompleteStaticRoot(outDir)) {
    const meta = readBuildMeta(outDir);
    items.push({
      id: 'out',
      abs: outDir,
      label: formatLabel('out (latest)', null, meta),
      parkedAt: null,
      meta,
    });
  }
  const backupRoot = join(repoRoot, 'out-backup');
  if (existsSync(backupRoot)) {
    const names = readdirSync(backupRoot)
      .filter((name) => {
        const full = join(backupRoot, name);
        return statSync(full).isDirectory() && isCompleteStaticRoot(full);
      })
      .sort()
      .reverse();
    for (const name of names) {
      const abs = join(backupRoot, name);
      const meta = readBuildMeta(abs);
      items.push({
        id: `out-backup/${name}`,
        abs,
        label: formatLabel(`out-backup/${name}`, name, meta),
        parkedAt: name,
        meta,
      });
    }
  }
  return items;
}

function formatLabel(id, parkedAt, meta) {
  const built = typeof meta?.builtAt === 'string' ? meta.builtAt : null;
  const git = typeof meta?.git === 'string' ? meta.git : null;
  const parts = [id];
  if (built) {
    parts.push(`built ${built}`);
  }
  if (parkedAt) {
    parts.push(`parkedAt ${parkedAt}`);
  }
  if (git) {
    parts.push(git);
  }
  return parts.join(' | ');
}

export function resolveStaticRoot(repoRoot, requested) {
  const raw = (requested ?? process.env.STATIC_ROOT ?? 'out').trim().replaceAll('\\', '/');
  const abs = resolve(repoRoot, raw);
  const rel = relative(repoRoot, abs).replaceAll('\\', '/');
  if (rel.startsWith('..') || resolve(abs) === resolve(repoRoot)) {
    throw new Error(`STATIC_ROOT must be inside the repo: ${raw}`);
  }
  if (!rel.startsWith('out') && rel !== 'out') {
    throw new Error(`STATIC_ROOT must be out or out-backup/<stamp>: ${raw}`);
  }
  if (!isCompleteStaticRoot(abs)) {
    throw new Error(`No index.html in ${abs}`);
  }
  return { abs, id: rel.replaceAll('\\', '/') };
}

export function warnIfRollback(repoRoot, chosenAbs) {
  const latest = join(repoRoot, 'out');
  if (resolve(chosenAbs) === resolve(latest)) {
    return;
  }
  const chosenMeta = readBuildMeta(chosenAbs);
  const latestMeta = readBuildMeta(latest);
  const chosenGen = Number(chosenMeta?.schemaGeneration ?? SCHEMA_GENERATION);
  const latestGen = Number(latestMeta?.schemaGeneration ?? SCHEMA_GENERATION);
  if (chosenGen < latestGen) {
    console.warn(
      'Refusing older schemaGeneration. Export project data before serving a backup with a lower schema.',
    );
    throw new Error(
      `schemaGeneration ${chosenGen} < latest ${latestGen}; rollback blocked`,
    );
  }
  console.warn(
    'Serving a parked backup (shell rollback). IndexedDB/OPFS stay on this origin and may not match an older shell.',
  );
  console.warn('iPad: reopen from the home-screen icon after this process restarts.');
}

export function pruneBackups(repoRoot) {
  const backupRoot = join(repoRoot, 'out-backup');
  if (!existsSync(backupRoot)) {
    return;
  }
  const dirs = readdirSync(backupRoot)
    .map((name) => ({ name, abs: join(backupRoot, name) }))
    .filter((item) => statSync(item.abs).isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name));
  const complete = dirs.filter((item) => isCompleteStaticRoot(item.abs));
  const incomplete = dirs.filter((item) => !isCompleteStaticRoot(item.abs));
  for (const item of incomplete) {
    rmSync(item.abs, { recursive: true, force: true });
    console.log(`Removed incomplete backup ${item.abs}`);
  }
  for (const item of complete.slice(BACKUP_KEEP)) {
    rmSync(item.abs, { recursive: true, force: true });
    console.log(`Pruned old backup ${item.abs}`);
  }
}
