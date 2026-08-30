'use client';

import { useEffect, useRef, useState } from 'react';
import { loadProjectPreviewPages, type ProjectPreviewPage } from '@/src/storage';
import { PAGE_TEMPLATE_URL } from '@/src/web/PageThumbLayers';
import { drawPageTextsOnThumb } from '@/src/web/ink/drawPageTextsOnThumb';
import { THUMB_HEIGHT, THUMB_WIDTH } from '@/src/web/ink/InkEngine';
import styles from '@/app/page.module.css';

const MAX_THUMBS = 2;

let templatePromise: Promise<HTMLImageElement> | null = null;

function loadTemplate(): Promise<HTMLImageElement> {
  if (!templatePromise) {
    templatePromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('page_template.jpg failed'));
      img.src = PAGE_TEMPLATE_URL;
    });
  }
  return templatePromise;
}

function toPngBlob(png: ArrayBuffer): Blob {
  const copy = new Uint8Array(png.byteLength);
  copy.set(new Uint8Array(png));
  return new Blob([copy], { type: 'image/png' });
}

async function decodeRaster(png: ArrayBuffer): Promise<ImageBitmap | HTMLImageElement> {
  const blob = toPngBlob(png);
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Safari HTTP / detached buffer: fall through to Image
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('png decode failed'));
    };
    img.src = url;
  });
}

function MiniPage({ page }: { page: ProjectPreviewPage | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let cancelled = false;
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    void (async () => {
      try {
        const template = await loadTemplate();
        if (cancelled) {
          return;
        }
        ctx.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        ctx.drawImage(template, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        if (page?.png) {
          const raster = await decodeRaster(page.png);
          if (cancelled) {
            return;
          }
          ctx.drawImage(raster, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
          if ('close' in raster && typeof raster.close === 'function') {
            raster.close();
          }
        }
        if (page && page.texts.length > 0) {
          drawPageTextsOnThumb(
            ctx,
            page.texts,
            page.rasterWidth,
            page.rasterHeight,
            THUMB_WIDTH,
            THUMB_HEIGHT,
          );
        }
      } catch {
        // leave canvas as-is if template or ink decode fails
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page]);

  return <canvas ref={canvasRef} className={styles.miniPageCanvas} aria-hidden />;
}

export function ProjectListThumbs({
  projectId,
  pageCount,
}: {
  projectId: string;
  pageCount: number;
}) {
  const [pages, setPages] = useState<ProjectPreviewPage[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadProjectPreviewPages(projectId, MAX_THUMBS).then(
      (loaded) => {
        if (cancelled) {
          return;
        }
        setPages(loaded);
      },
      () => {
        if (!cancelled) {
          setPages([]);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, pageCount]);

  const slotCount = Math.min(MAX_THUMBS, Math.max(1, pageCount));
  const slots: Array<ProjectPreviewPage | null> =
    pages && pages.length > 0 ? pages : Array.from({ length: slotCount }, () => null);

  return (
    <>
      {slots.map((page, index) => (
        <span key={page?.pageId ?? `slot-${index}`} className={styles.miniPage}>
          <MiniPage page={page} />
        </span>
      ))}
    </>
  );
}
