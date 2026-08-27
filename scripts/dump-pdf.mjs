import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = new Uint8Array(readFileSync(join(root, 'sample', 'sample.pdf')));

const loading = getDocument({
  data,
  useSystemFonts: true,
  isEvalSupported: false,
  disableWorker: true,
});
const pdf = await loading.promise;
const pages = [];
for (let n = 1; n <= pdf.numPages; n += 1) {
  const page = await pdf.getPage(n);
  const content = await page.getTextContent();
  const items = content.items
    .filter((item) => 'str' in item)
    .map((item) => {
      const it = item;
      const transform = it.transform ?? [0, 0, 0, 0, 0, 0];
      const fontSize = it.height || Math.hypot(transform[0], transform[1]);
      return {
        str: it.str,
        x: transform[4],
        y: transform[5],
        width: it.width,
        height: fontSize,
        fontSize,
      };
    });
  let structRoleCount = 0;
  try {
    const tree = await page.getStructTree();
    const walk = (node) => {
      if (!node) return;
      if (node.role === 'Ruby' || node.role === 'Rt') structRoleCount += 1;
      for (const child of node.children ?? []) {
        if (typeof child === 'object') walk(child);
      }
    };
    walk(tree);
  } catch {
    // tagged tree optional
  }
  pages.push({ page: n, items, structRoleCount });
}

process.stdout.write(JSON.stringify({ pageCount: pdf.numPages, pages }));
