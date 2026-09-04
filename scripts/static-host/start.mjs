import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { stdin as stdinStream, stdout as stdoutStream } from 'node:process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startLanServers } from './lan.mjs';
import { listStaticRoots, resolveStaticRoot, warnIfRollback } from './roots.mjs';

const repoRoot = process.cwd();
export const SERVE_PORT = 13443;
export const HTTP_PORT = 3001;
const APP_URL = `http://127.0.0.1:${HTTP_PORT}/`;

function parseArgs(argv) {
  let chrome = false;
  let lan = false;
  let rootArg = process.env.STATIC_ROOT ?? '';
  for (const arg of argv) {
    if (arg === '--chrome') {
      chrome = true;
    } else if (arg === '--lan') {
      lan = true;
    } else if (arg === '--pick') {
      // kept for old bats: initial pick is no longer used; REPL runs after start
    } else if (arg.startsWith('--root=')) {
      rootArg = arg.slice('--root='.length);
    }
  }
  return { chrome, lan, rootArg };
}

function proxyToServe(req, res) {
  const upstream = httpRequest(
    {
      hostname: '127.0.0.1',
      port: SERVE_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${SERVE_PORT}` },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end('proxy error');
  });
  req.pipe(upstream);
}

function waitForPort(port, timeoutMs, wantOpen) {
  const started = Date.now();
  return new Promise((resolveWait, reject) => {
    const tryOnce = () => {
      const sock = createConnection({ host: '127.0.0.1', port }, () => {
        sock.end();
        if (wantOpen) {
          resolveWait();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for 127.0.0.1:${port} to close`));
          return;
        }
        setTimeout(tryOnce, 150);
      });
      sock.on('error', () => {
        sock.destroy();
        if (!wantOpen) {
          resolveWait();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for 127.0.0.1:${port}`));
          return;
        }
        setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

function initialRoot(rootArg) {
  if (rootArg) {
    return resolveStaticRoot(repoRoot, rootArg);
  }
  const items = listStaticRoots(repoRoot);
  const latest = items.find((item) => item.id === 'out') ?? items[0];
  if (!latest) {
    throw new Error('No complete static tree (out/ or out-backup/). Run build:static first.');
  }
  return { abs: latest.abs, id: latest.id };
}

function printRoots(currentId) {
  const items = listStaticRoots(repoRoot);
  console.log('Static trees (folder name is parkedAt, not builtAt):');
  items.forEach((item, index) => {
    const mark = item.id === currentId ? ' *' : '';
    console.log(`  [${index + 1}] ${item.label}${mark}`);
  });
  return items;
}

function printHelp() {
  console.log('Commands:');
  console.log('  list / ls          show trees');
  console.log('  1, 2, ...          switch to that tree (restarts serve only)');
  console.log('  out                latest out/');
  console.log('  out-backup/<name>  parked backup');
  console.log('  help               this text');
  console.log('  quit / exit        stop host');
  console.log('iPad: after a switch, reopen from the home-screen icon.');
}

function findChrome() {
  const candidates = [
    join(process.env['ProgramFiles'] ?? '', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ];
  return candidates.find((path) => path && existsSync(path));
}

function openChromeApp() {
  const chrome = findChrome();
  const profile = join(repoRoot, '.chrome-static-profile');
  if (!chrome) {
    console.log(`Chrome not found. Open ${APP_URL}`);
    return;
  }
  for (const extra of ['Default/Service Worker', 'Default/Cache', 'Default/Code Cache']) {
    rmSync(join(profile, extra), { recursive: true, force: true });
  }
  spawn(
    chrome,
    [
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-http-cache',
      '--disable-features=ServiceWorker',
      `--app=${APP_URL}`,
    ],
    { detached: true, stdio: 'ignore' },
  ).unref();
  console.log(`Chrome app: ${APP_URL}`);
}

function spawnServe(abs) {
  return spawn(
    'npx',
    ['--yes', 'serve', abs, '-l', `tcp://127.0.0.1:${SERVE_PORT}`, '-n', '--no-port-switching'],
    { cwd: repoRoot, stdio: 'ignore', shell: true },
  );
}

function killServeTree(child) {
  if (!child?.pid) {
    return Promise.resolve();
  }
  return new Promise((done) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('exit', () => done());
    killer.on('error', () => {
      child.kill();
      done();
    });
  });
}

export async function main(extra = {}) {
  const flags = { ...parseArgs(process.argv.slice(2)), ...extra };
  let current = initialRoot(flags.rootArg);
  warnIfRollback(repoRoot, current.abs);
  console.log(`STATIC_ROOT=${current.id}`);
  console.log(`abs=${current.abs}`);

  let serving = true;
  let child = spawnServe(current.abs);
  child.on('exit', () => {
    if (serving) {
      console.error('serve exited');
      process.exit(1);
    }
  });
  await waitForPort(SERVE_PORT, 30_000, true);

  const httpServer = createServer(proxyToServe);
  await new Promise((done) => httpServer.listen(HTTP_PORT, '127.0.0.1', done));
  console.log(`PC HTTP: ${APP_URL}`);

  let lan = null;
  if (flags.lan) {
    lan = await startLanServers(repoRoot, proxyToServe);
  }
  if (flags.chrome) {
    openChromeApp();
  }

  const shutdown = async (code) => {
    serving = false;
    await killServeTree(child);
    lan?.close();
    httpServer.close();
    process.exit(code ?? 0);
  };
  process.on('SIGINT', () => {
    void shutdown(0);
  });

  if (!stdinStream.isTTY) {
    return;
  }

  printRoots(current.id);
  printHelp();

  const rl = createInterface({ input: stdinStream, output: stdoutStream, prompt: 'static-host> ' });
  let busy = false;
  rl.prompt();
  rl.on('line', (line) => {
    void (async () => {
      const cmd = line.trim();
      if (busy) {
        console.log('busy');
        rl.prompt();
        return;
      }
      if (!cmd || cmd === 'help' || cmd === '?') {
        if (cmd) {
          printHelp();
        }
        rl.prompt();
        return;
      }
      if (cmd === 'list' || cmd === 'ls') {
        printRoots(current.id);
        rl.prompt();
        return;
      }
      if (cmd === 'quit' || cmd === 'exit' || cmd === 'q') {
        rl.close();
        await shutdown(0);
        return;
      }
      const items = listStaticRoots(repoRoot);
      let next = null;
      const asNum = Number.parseInt(cmd, 10);
      if (String(asNum) === cmd && asNum >= 1 && items[asNum - 1]) {
        const item = items[asNum - 1];
        next = { abs: item.abs, id: item.id };
      } else {
        try {
          next = resolveStaticRoot(repoRoot, cmd);
        } catch (err) {
          console.log(err instanceof Error ? err.message : err);
          rl.prompt();
          return;
        }
      }
      if (next.id === current.id) {
        console.log(`already ${current.id}`);
        rl.prompt();
        return;
      }
      try {
        warnIfRollback(repoRoot, next.abs);
      } catch (err) {
        console.log(err instanceof Error ? err.message : err);
        rl.prompt();
        return;
      }
      busy = true;
      serving = false;
      const previous = current;
      try {
        await killServeTree(child);
        await waitForPort(SERVE_PORT, 15_000, false);
        child = spawnServe(next.abs);
        serving = true;
        child.on('exit', () => {
          if (serving) {
            console.error('serve exited');
            process.exit(1);
          }
        });
        await waitForPort(SERVE_PORT, 30_000, true);
        current = next;
        console.log(`STATIC_ROOT=${current.id}`);
        console.log('Reload PC; iPad: home-screen icon.');
      } catch (err) {
        console.log(err instanceof Error ? err.message : err);
        try {
          child = spawnServe(previous.abs);
          serving = true;
          child.on('exit', () => {
            if (serving) {
              console.error('serve exited');
              process.exit(1);
            }
          });
          await waitForPort(SERVE_PORT, 30_000, true);
          current = previous;
          console.log(`restored STATIC_ROOT=${current.id}`);
        } catch (restoreErr) {
          serving = true;
          console.log(restoreErr instanceof Error ? restoreErr.message : restoreErr);
        }
      } finally {
        busy = false;
        rl.prompt();
      }
    })();
  });
}

function isEntry() {
  try {
    return import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
  } catch {
    return false;
  }
}

if (isEntry()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
