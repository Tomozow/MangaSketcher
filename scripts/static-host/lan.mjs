import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CA_PORT, HTTPS_PORT, certPaths, ensureLanLeaf, lanIPv4s } from '../lanHttpsShared.mjs';
import { handleLanPack, sweepLanPackDir } from './lanPackHub.mjs';

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

function caAppLinks(ip) {
  const ips = [ip, ...lanIPv4s().filter((item) => item !== ip)];
  return ips
    .map(
      (item) =>
        `<a class="appLink" href="https://${item}:${HTTPS_PORT}/">https://${item}:${HTTPS_PORT}/</a>`,
    )
    .join('');
}

export function caPage(ip) {
  const links = caAppLinks(ip);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  <meta name="theme-color" content="#f4f1ea"/>
  <title>MangaSketcher 証明書</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      font-family: system-ui, sans-serif;
      line-height: 1.5;
      color: #2b2620;
      background:
        radial-gradient(1200px 400px at 10% -10%, rgba(61, 90, 128, 0.1), transparent 50%),
        #f4f1ea;
    }
    .wrap {
      max-width: 40rem;
      margin: 0 auto;
      padding: max(22px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right))
        max(28px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 22px;
    }
    .mark {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: #1c1c22;
      color: #f4f1ea;
      display: grid;
      place-items: center;
      font-weight: 700;
      font-size: 14px;
      flex: none;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 650;
      letter-spacing: -0.03em;
    }
    .sub {
      display: block;
      font-size: 11px;
      color: #6f675c;
    }
    h2 {
      margin: 22px 0 8px;
      font-size: 15px;
      font-weight: 650;
    }
    p, li { font-size: 14px; }
    p { margin: 0 0 10px; color: #3f3a34; }
    .lead { color: #2b2620; }
    .note {
      margin: 12px 0 0;
      padding: 12px 14px;
      border: 1px solid #c9c0b0;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.55);
      color: #6f675c;
      font-size: 13px;
    }
    .download {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      margin: 14px 0 12px;
      padding: 0 16px;
      border-radius: 999px;
      background: #1c1c22;
      color: #f4f1ea;
      font-size: 13px;
      font-weight: 650;
      text-decoration: none;
    }
    ol {
      margin: 0;
      padding-left: 1.35rem;
    }
    li + li { margin-top: 10px; }
    .appLink {
      display: block;
      margin-top: 6px;
      color: #2b2620;
      font-size: 13px;
      word-break: break-all;
    }
    strong { font-weight: 650; }
    @media (prefers-color-scheme: dark) {
      body {
        color: #f6f3ec;
        background:
          radial-gradient(1200px 400px at 10% -10%, rgba(61, 90, 128, 0.22), transparent 50%),
          #1c1c22;
      }
      .mark { background: #f6f3ec; color: #1c1c22; }
      .sub, .note { color: rgba(246, 243, 236, 0.55); }
      p { color: rgba(246, 243, 236, 0.82); }
      .lead { color: #f6f3ec; }
      .note {
        border-color: rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
      }
      .download { background: #f6f3ec; color: #1c1c22; }
      .appLink { color: #f6f3ec; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="brand">
      <div class="mark" aria-hidden="true">MS</div>
      <div>
        <h1>iPad用セットアップ</h1>
        <span class="sub">同じ Wi-Fi · Safari</span>
      </div>
    </header>
    <p class="lead">このページは証明書を入れるためのものです。アプリ本体ではありません。PC と iPad を同じ Wi-Fi にし、<strong>Safari</strong>で開いてください。Chrome ではプロファイルもホーム画面追加も失敗します。</p>
    <h2>1. 証明書を入れる</h2>
    <p>下のボタンで構成プロファイルをダウンロードします。警告が出ても、家庭内の PC が発行した MangaSketcher 用の証明書です。</p>
    <a class="download" href="/MangaSketcher-LAN.mobileconfig" download="MangaSketcher-LAN.mobileconfig">
      プロファイルをダウンロード
    </a>
    <ol>
      <li>設定アプリを開くと「プロファイルがダウンロード済み」と出ます。そこを開き、<strong>インストール</strong>をタップします。パスコードを求められたら入力します。</li>
      <li>設定 → 一般 → 情報 → <strong>証明書信頼設定</strong>を開きます。</li>
      <li><strong>mkcert</strong>で始まる項目をオンにします。表示名は MangaSketcher ではありません。オフのままだと Safari の警告が消えません。</li>
    </ol>
    <h2>2. アプリを Safari で開く</h2>
    <p>信頼をオンにしたあと、次のアドレスを Safari で開き直します。「この接続はプライベートではありません」が出ていれば、まだ信頼ができていません。手順 1 に戻ってください。</p>
    ${links}
    <p>Ethernet と Wi-Fi でアドレスが二つあるときは、iPad が使っているほうを開きます。</p>
    <h2>3. ホーム画面に追加する</h2>
    <p>手順 2 のアドレスを、警告の出ていない Safari で開いたまま作業します。この証明書ページではなく、アプリの画面に対して行います。</p>
    <ol>
      <li>画面右上の四角から矢印が上に出ている<strong>共有</strong>ボタンをタップします。</li>
      <li>出てきた一覧を下へスクロールします。「Dock に追加」は使わず、その下にある<strong>ホーム画面に追加</strong>をタップします。</li>
      <li>名前の確認が出たら、そのまま「追加」をタップします。アイコンがホーム画面に置かれます。</li>
      <li>Safari を閉じ、ホーム画面を左右に送ってアイコンを探し、そこから開きます。以後はタブではなく、このアイコンから使います。</li>
    </ol>
    <p class="note">「ホーム画面に追加」が見つからないときは、共有シートの一番下の「編集」から追加できます。以前の MangaSketcher アイコンが残っているときは、先に長押しして削除してから、同じ手順をもう一度行います。</p>
  </div>
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
  writeFileSync(
    join(certDir, 'public', 'setup.json'),
    `${JSON.stringify({ caPageUrl: `http://${ip}:${CA_PORT}/` })}\n`,
  );

  const publicDir = join(certDir, 'public');
  const caServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${ip}`);
    let file = 'index.html';
    if (url.pathname.endsWith('.mobileconfig')) {
      file = 'MangaSketcher-LAN.mobileconfig';
    } else if (url.pathname.endsWith('ca.pem')) {
      file = 'ca.pem';
    } else if (url.pathname.endsWith('setup.json')) {
      file = 'setup.json';
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
        : file.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : 'text/html; charset=utf-8';
    const headers = { 'Content-Type': type };
    if (file === 'setup.json') {
      headers['Access-Control-Allow-Origin'] = '*';
      headers['Cache-Control'] = 'no-store';
    }
    res.writeHead(200, headers);
    res.end(readFileSync(full));
  });

  await new Promise((done) => caServer.listen(CA_PORT, '0.0.0.0', done));

  sweepLanPackDir(join(repoRoot, '.lan-transfer'));

  const appServer = createHttpsServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `https://${ip}`);
      if (req.method === 'GET' && url.pathname === '/api/lan-setup') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ caPageUrl: `http://${ip}:${CA_PORT}/` }));
        return;
      }
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
      if (await handleLanPack(req, res, { repoRoot })) {
        return;
      }
      proxyToServe(req, res);
    })();
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
