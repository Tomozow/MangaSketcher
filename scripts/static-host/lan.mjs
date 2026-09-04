import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CA_PORT, HTTPS_PORT, certPaths, ensureLanLeaf, lanIPv4s } from '../lanHttpsShared.mjs';

function persistDebugLog(repoRoot, raw) {
  const lines = String(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    let sessionId = 'ipad';
    let ingest = process.env.CURSOR_DEBUG_INGEST ?? '';
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) {
        sessionId = parsed.sessionId;
      }
      if (typeof parsed.ingest === 'string' && parsed.ingest.length > 0) {
        ingest = parsed.ingest;
      }
    } catch {
      // keep defaults
    }
    try {
      appendFileSync(join(repoRoot, `debug-${sessionId}.log`), `${line}\n`);
      mkdirSync(join(repoRoot, '.cursor'), { recursive: true });
      appendFileSync(join(repoRoot, '.cursor', `debug-${sessionId}.log`), `${line}\n`);
    } catch {
      // ignore disk errors
    }
    if (ingest) {
      fetch(ingest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': sessionId },
        body: line,
      }).catch(() => {});
    }
  }
}

function pemToMobileconfig(pem, displayName) {
  const derB64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  const uuid1 = crypto.randomUUID().toUpperCase();
  const uuid2 = crypto.randomUUID().toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>${displayName}.cer</string>
      <key>PayloadContent</key>
      <data>${derB64}</data>
      <key>PayloadDescription</key>
      <string>MangaSketcher の LAN HTTPS 用ルート証明書</string>
      <key>PayloadDisplayName</key>
      <string>${displayName}</string>
      <key>PayloadIdentifier</key>
      <string>dev.mangasketcher.lan-ca</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${uuid1}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>iPad で MangaSketcher をホーム画面に追加するための証明書です。</string>
  <key>PayloadDisplayName</key>
  <string>${displayName}</string>
  <key>PayloadIdentifier</key>
  <string>dev.mangasketcher.lan</string>
  <key>PayloadOrganization</key>
  <string>MangaSketcher</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${uuid2}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}

function caPage(ip) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>MangaSketcher 証明書</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #2b2620; }
    .download {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      margin: 1rem 0 1.5rem;
      padding: 0 20px;
      border-radius: 12px;
      background: #3d5a80;
      color: #fff;
      font-weight: 600;
      text-decoration: none;
    }
    a { color: #3d5a80; }
    ol { padding-left: 1.25rem; }
    strong { background: #fff3c4; }
  </style>
</head>
<body>
  <h1>証明書プロファイル</h1>
  <a class="download" href="/MangaSketcher-LAN.mobileconfig" download="MangaSketcher-LAN.mobileconfig">
    プロファイルをダウンロード
  </a>
  <p>タップすると設定に「プロファイルがダウンロード済み」と出ます。そこからインストールしてください。</p>
  <h2>警告を消す</h2>
  <p>プロファイルを入れただけでは足りません。</p>
  <ol>
    <li>設定 → 一般 → 情報 → <strong>証明書信頼設定</strong></li>
    <li><strong>mkcert</strong> で始まる項目をオンにする</li>
    <li>Safari で次のどちらかを開き直す（警告が出ないこと）:
      <br/><a href="https://${ip}:${HTTPS_PORT}/">https://${ip}:${HTTPS_PORT}/</a>
${lanIPv4s()
  .filter((item) => item !== ip)
  .map((item) => `      <br/><a href="https://${item}:${HTTPS_PORT}/">https://${item}:${HTTPS_PORT}/</a>`)
  .join('\n')}
    </li>
    <li>警告が消えたら、ホーム画面のアイコンを削除して入れ直す</li>
  </ol>
</body>
</html>`;
}

export async function startLanServers(repoRoot, proxyToServe) {
  const { certDir, caPem, certFile, keyFile } = certPaths(repoRoot);
  const { ip } = await ensureLanLeaf(repoRoot);
  mkdirSync(join(certDir, 'public'), { recursive: true });
  const pem = readFileSync(caPem, 'utf8');
  const profilePath = join(certDir, 'public', 'MangaSketcher-LAN.mobileconfig');
  writeFileSync(profilePath, pemToMobileconfig(pem, 'MangaSketcher LAN CA'));
  writeFileSync(join(certDir, 'public', 'index.html'), caPage(ip));
  writeFileSync(join(certDir, 'public', 'ca.pem'), pem);

  const publicDir = join(certDir, 'public');
  const caServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${ip}`);
    let file = 'index.html';
    if (url.pathname.endsWith('.mobileconfig')) {
      file = 'MangaSketcher-LAN.mobileconfig';
    } else if (url.pathname.endsWith('ca.pem')) {
      file = 'ca.pem';
    }
    const full = resolve(publicDir, file);
    if (!full.startsWith(resolve(publicDir)) || !existsSync(full)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const type = file.endsWith('.mobileconfig')
      ? 'application/x-apple-aspen-config'
      : file.endsWith('.pem')
        ? 'application/x-pem-file'
        : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(readFileSync(full));
  });

  await new Promise((done) => caServer.listen(CA_PORT, '0.0.0.0', done));

  const appServer = createHttpsServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, (req, res) => {
    const url = new URL(req.url ?? '/', `https://${ip}`);
    if (req.method === 'POST' && url.pathname === '/api/debug-log') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        persistDebugLog(repoRoot, Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ok');
      });
      return;
    }
    proxyToServe(req, res);
  });
  await new Promise((done) => appServer.listen(HTTPS_PORT, '0.0.0.0', done));

  console.log(`CA page:  http://${ip}:${CA_PORT}/`);
  console.log(`App HTTPS: https://${ip}:${HTTPS_PORT}/`);
  console.log('iPad: after a root change, open from the home-screen icon (not a Safari tab).');

  return {
    ip,
    close() {
      caServer.close();
      appServer.close();
    },
  };
}
