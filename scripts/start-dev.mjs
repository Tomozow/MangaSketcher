import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { DEV_HTTPS_PORT, certPaths, ensureLanLeaf, lanIPv4Entries } from './lanHttpsShared.mjs';

const root = process.cwd();

async function main() {
  const { ip, certFile, keyFile } = await ensureLanLeaf(root);
  const { caPem } = certPaths(root);
  console.log(`One Next.js HTTPS server on port ${DEV_HTTPS_PORT} (hot reload).`);
  console.log(`PC: https://127.0.0.1:${DEV_HTTPS_PORT}/`);
  const nics = lanIPv4Entries();
  if (nics.length === 0) {
    console.log(`iPad: https://${ip}:${DEV_HTTPS_PORT}/`);
  } else {
    console.log('iPad (same server; use the NIC that shares Wi-Fi with the iPad):');
    for (const item of nics) {
      console.log(`  ${item.iface}: https://${item.address}:${DEV_HTTPS_PORT}/`);
    }
  }
  console.log('Safari warning: http://<that-IP>:3002/ (start:https-lan). Static build is :3443.');

  const httpsArgs = [
    'next',
    'dev',
    '--hostname',
    '0.0.0.0',
    '--port',
    String(DEV_HTTPS_PORT),
    '--experimental-https',
    '--experimental-https-key',
    keyFile,
    '--experimental-https-cert',
    certFile,
  ];
  if (existsSync(caPem)) {
    httpsArgs.push('--experimental-https-ca', caPem);
  }

  const child = spawn('npx', httpsArgs, { cwd: root, stdio: 'inherit', shell: true });

  const stop = () => {
    if (!child.killed) {
      child.kill();
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
