import { TEMPLATE_PAGE_NUMBER_COVER } from '../../domain/types';
import { drawPageTextsOnThumb, type ThumbText } from '../ink/drawPageTextsOnThumb';
import { isPngBuffer } from '../ink/fakeCanvas';
import { PAGE_TEMPLATE_URL } from './constants';
import { WorkspaceExportError } from './errors';

export type ExportCanvas = OffscreenCanvas | HTMLCanvasElement;

export type ExportComposeContext = {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  imageSmoothingEnabled?: boolean;
  imageSmoothingQuality?: ImageSmoothingQuality;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fillText(text: string, x: number, y: number): void;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
};

export function createExportCanvas(width: number, height: number): ExportCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document === 'undefined') {
    throw new WorkspaceExportError();
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function paintExportPageLayers(
  ctx: ExportComposeContext,
  input: {
    width: number;
    height: number;
    template: CanvasImageSource;
    inkBitmap?: CanvasImageSource | null;
    texts: readonly ThumbText[];
  },
): void {
  const { width, height, template, inkBitmap, texts } = input;
  if ('imageSmoothingEnabled' in ctx) {
    ctx.imageSmoothingEnabled = true;
  }
  if ('imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(template, 0, 0, width, height);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(
    TEMPLATE_PAGE_NUMBER_COVER.x * width,
    TEMPLATE_PAGE_NUMBER_COVER.y * height,
    TEMPLATE_PAGE_NUMBER_COVER.width * width,
    TEMPLATE_PAGE_NUMBER_COVER.height * height,
  );
  if (inkBitmap) {
    ctx.drawImage(inkBitmap, 0, 0, width, height);
  }
  drawPageTextsOnThumb(ctx, texts, width, height, width, height);
}

export function canvasToPngBlob(canvas: ExportCanvas): Promise<Blob> {
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob || blob.size === 0) {
          reject(new WorkspaceExportError());
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }
  const offscreen = canvas as OffscreenCanvas;
  if (typeof offscreen.convertToBlob !== 'function') {
    return Promise.reject(new WorkspaceExportError());
  }
  return offscreen.convertToBlob({ type: 'image/png' }).then((blob) => {
    if (!blob || blob.size === 0) {
      throw new WorkspaceExportError();
    }
    return blob;
  });
}

export async function canvasToPngBytes(canvas: ExportCanvas): Promise<Uint8Array> {
  const blob = await canvasToPngBlob(canvas);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function composePagePng(input: {
  canvas: ExportCanvas;
  template: CanvasImageSource;
  inkBitmap?: CanvasImageSource | null;
  texts: readonly ThumbText[];
  width: number;
  height: number;
}): Promise<Uint8Array> {
  const ctx = input.canvas.getContext('2d');
  if (!ctx) {
    throw new WorkspaceExportError();
  }
  paintExportPageLayers(ctx as unknown as ExportComposeContext, {
    width: input.width,
    height: input.height,
    template: input.template,
    inkBitmap: input.inkBitmap,
    texts: input.texts,
  });
  return canvasToPngBytes(input.canvas);
}

export function loadPageTemplateImage(src = PAGE_TEMPLATE_URL): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const succeed = () => {
      if (img.naturalWidth > 0) {
        resolve(img);
        return;
      }
      reject(new WorkspaceExportError());
    };
    img.onload = succeed;
    img.onerror = () => reject(new WorkspaceExportError());
    img.src = src;
    if (img.complete) {
      succeed();
    }
  });
}

export function closeCanvasImage(source: { close?: () => void } | null | undefined): void {
  source?.close?.();
}

export async function decodeExportPng(buffer: ArrayBuffer): Promise<ImageBitmap> {
  if (!isPngBuffer(buffer)) {
    throw new WorkspaceExportError();
  }
  try {
    const blob = new Blob([buffer], { type: 'image/png' });
    return await createImageBitmap(blob);
  } catch {
    throw new WorkspaceExportError();
  }
}
