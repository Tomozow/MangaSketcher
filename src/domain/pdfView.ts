/** ページ番号が変わるとキーが変わるので、ビューアは再マウント／再描画する。 */
export function pdfPageViewerKey(uri: string, currentPage: number): string {
  return `${uri}#page=${clampPdfPage(currentPage, Number.MAX_SAFE_INTEGER)}`;
}

export function clampPdfPage(page: number, pageCount: number): number {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  const n = Math.floor(page);
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.min(count, Math.max(1, n));
}

/**
 * pdf.js で指定ページだけを canvas に焼く HTML。
 * `source.html` と key の両方にページ番号を入れるので、送りでも画像が差し替わる。
 */
export function pdfPageViewerHtml(base64: string, page: number): string {
  const pageNum = clampPdfPage(page, Number.MAX_SAFE_INTEGER);
  const payload = JSON.stringify({ b64: base64, page: pageNum });
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>
    html, body { margin: 0; padding: 0; background: #E8E2D6; height: 100%; overflow: hidden; }
    canvas { display: block; width: 100%; height: 100%; object-fit: contain; }
  </style>
</head>
<body>
<canvas id="c"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const PAYLOAD = ${payload};
  function paint(pageNum, b64) {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    pdfjsLib.getDocument({ data: bytes }).promise.then(function (pdf) {
      const n = Math.min(pdf.numPages, Math.max(1, pageNum));
      return pdf.getPage(n);
    }).then(function (page) {
      const canvas = document.getElementById("c");
      const ctx = canvas.getContext("2d");
      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = Math.min(vw / unscaled.width, vh / unscaled.height);
      const viewport = page.getViewport({ scale: scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      return page.render({ canvasContext: ctx, viewport: viewport }).promise;
    }).catch(function (err) {
      document.body.innerText = String(err);
    });
  }
  paint(PAYLOAD.page, PAYLOAD.b64);
  function onMsg(e) {
    try {
      const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      if (data && data.page) paint(data.page, data.b64 || PAYLOAD.b64);
    } catch (err) {}
  }
  document.addEventListener("message", onMsg);
  window.addEventListener("message", onMsg);
</script>
</body>
</html>`;
}

export function pdfPageRenderCommand(page: number, base64: string): string {
  return JSON.stringify({ page: clampPdfPage(page, Number.MAX_SAFE_INTEGER), b64: base64 });
}
